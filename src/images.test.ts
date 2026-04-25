import { describe, expect, test } from "bun:test";
import { importImagePlan, parseImageReference, planImageImports, resolveImage, validateImageStore } from "./images";

describe("parseImageReference", () => {
  test("accepts local IDs", () => {
    const reference = parseImageReference("local/endeavouros");

    expect(reference.kind).toBe("local");
    expect(reference.id).toBe("local/endeavouros");
    expect(reference.imageId).toBe("endeavouros");
  });

  test("accepts GitHub-backed IDs", () => {
    const reference = parseImageReference("hydroxide-dev/image/debian-13-trixie");

    expect(reference.kind).toBe("github");
    expect(reference.repository).toBe("hydroxide-dev/image");
    expect(reference.imageId).toBe("debian-13-trixie");
  });

  test("accepts catalog IDs from the default image repository", () => {
    const reference = parseImageReference("ubuntu-24.04");

    expect(reference.kind).toBe("github");
    expect(reference.repository).toBe("hydroxide-dev/image");
    expect(reference.imageId).toBe("ubuntu-24.04");
  });
});

describe("resolveImage", () => {
  test("resolves a local image from the store", async () => {
    const store = validateImageStore({
      version: 1,
      images: [
        {
          id: "local/endeavouros",
          localPath: "local:iso/endeavouros.qcow2",
          downloadUrl: "file:///srv/hydroxide/images/endeavouros.qcow2",
        },
      ],
    });

    const image = await resolveImage("local/endeavouros", store);

    expect(image.localPath).toBe("local:iso/endeavouros.qcow2");
    expect(image.downloadUrl).toBe("file:///srv/hydroxide/images/endeavouros.qcow2");
    expect(image.source.kind).toBe("local");
  });

  test("resolves a GitHub image from a manifest", async () => {
    const store = validateImageStore({
      version: 1,
      images: [
        {
          id: "hydroxide-dev/image/debian-13-trixie",
          localPath: "local:iso/debian-13.qcow2",
          manifestId: "debian-13",
        },
      ],
    });

    const image = await resolveImage(
      "hydroxide-dev/image/debian-13-trixie",
      store,
      async (url) => {
        expect(url).toBe("https://raw.githubusercontent.com/hydroxide-dev/image/main/manifest.json");

        return new Response(
          JSON.stringify({
            schema_version: 1,
            images: {
              "debian-13": {
                source: {
                  url: "https://cloud.example.test/debian-13.qcow2",
                },
              },
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
    );

    expect(image.localPath).toBe("local:iso/debian-13.qcow2");
    expect(image.downloadUrl).toBe("https://cloud.example.test/debian-13.qcow2");
    expect(image.source.kind).toBe("github");
    expect(image.source.manifestId).toBe("debian-13");
  });
});

describe("image import planning", () => {
  test("maps resolved images to import plans", async () => {
    const store = validateImageStore({
      version: 1,
      images: [
        {
          id: "local/endeavouros",
          localPath: "local:iso/endeavouros.qcow2",
          downloadUrl: "file:///srv/hydroxide/images/endeavouros.qcow2",
        },
      ],
    });

    const resolved = await resolveImage("local/endeavouros", store);
    const [plan] = planImageImports([resolved], true);

    expect(plan?.force).toBe(true);
    expect(plan?.localPath).toBe("local:iso/endeavouros.qcow2");
  });

  test("skips existing imports unless forced", async () => {
    const result = await importImagePlan(
      {
        id: "local/endeavouros",
        localPath: "local:iso/endeavouros.qcow2",
        downloadUrl: "file:///srv/hydroxide/images/endeavouros.qcow2",
        source: { kind: "local", url: "file:///srv/hydroxide/images/endeavouros.qcow2" },
        force: false,
      },
      async () => {
        throw new Error("runner should not be called");
      },
      async () => true,
    );

    expect(result.skipped).toBe(true);
    expect(result.imported).toBe(false);
  });
});

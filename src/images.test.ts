import { describe, expect, test } from "bun:test";
import { parseImageReference, resolveImage, validateImageStore } from "./images";

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
});

describe("resolveImage", () => {
  test("resolves a local image from the store", async () => {
    const store = validateImageStore({
      version: 1,
      images: [
        {
          id: "local/endeavouros",
          pvePath: "local:iso/endeavouros.qcow2",
          downloadUrl: "file:///srv/hydroxide/images/endeavouros.qcow2",
        },
      ],
    });

    const image = await resolveImage("local/endeavouros", store);

    expect(image.pvePath).toBe("local:iso/endeavouros.qcow2");
    expect(image.downloadUrl).toBe("file:///srv/hydroxide/images/endeavouros.qcow2");
    expect(image.source.kind).toBe("local");
  });

  test("resolves a GitHub image from a manifest", async () => {
    const store = validateImageStore({
      version: 1,
      images: [
        {
          id: "hydroxide-dev/image/debian-13-trixie",
          pvePath: "local:iso/debian-13.qcow2",
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

    expect(image.pvePath).toBe("local:iso/debian-13.qcow2");
    expect(image.downloadUrl).toBe("https://cloud.example.test/debian-13.qcow2");
    expect(image.source.kind).toBe("github");
    expect(image.source.manifestId).toBe("debian-13");
  });
});

import type {
  ImageReference,
  ImageStore,
  ImageStoreEntry,
  ResolvedImage,
  ResolvedImageSource,
} from "./types";

type GithubManifestImage = {
  source?: {
    url?: unknown;
  };
};

type GithubManifest = {
  images?: Record<string, GithubManifestImage | undefined>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid image store: ${path} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid image store: ${path} must be an object`);
  }

  return value;
}

function validateImageStoreEntry(value: unknown, index: number): ImageStoreEntry {
  const item = requireRecord(value, `images[${index}]`);

  return {
    id: asString(item.id, `images[${index}].id`),
    pvePath: asString(item.pvePath, `images[${index}].pvePath`),
    downloadUrl: optionalString(item.downloadUrl),
    manifestUrl: optionalString(item.manifestUrl),
    manifestId: optionalString(item.manifestId),
  };
}

export function validateImageStore(value: unknown): ImageStore {
  const root = requireRecord(value, "root");

  if (root.version !== 1) {
    throw new Error("Invalid image store: version must be 1");
  }

  if (!Array.isArray(root.images)) {
    throw new Error("Invalid image store: images must be an array");
  }

  return {
    version: 1,
    images: root.images.map((entry, index) => validateImageStoreEntry(entry, index)),
  };
}

export async function readImageStore(filePath = "config/images.json"): Promise<ImageStore> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Missing image store: ${filePath}`);
  }

  const text = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid image store: ${filePath} is not valid JSON (${message})`);
  }

  return validateImageStore(parsed);
}

export function parseImageReference(value: string): ImageReference {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid image ID: must be a non-empty string");
  }

  if (trimmed.startsWith("local/")) {
    return {
      kind: "local",
      id: trimmed,
      imageId: trimmed.slice("local/".length),
    };
  }

  const parts = trimmed.split("/").filter((part) => part.length > 0);
  if (parts.length < 3) {
    throw new Error(
      [
        "Invalid image ID:",
        "expected either local/<id> or <org>/<repo>/<id>",
      ].join(" "),
    );
  }

  const [org, repo, ...rest] = parts;
  return {
    kind: "github",
    id: trimmed,
    repository: `${org}/${repo}`,
    imageId: rest.join("/"),
  };
}

function githubManifestUrl(reference: ImageReference, entry?: ImageStoreEntry): string {
  if (entry?.manifestUrl) {
    return entry.manifestUrl;
  }

  return `https://raw.githubusercontent.com/${reference.repository}/main/manifest.json`;
}

async function readGithubManifest(url: string, fetcher: FetchLike): Promise<GithubManifest> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image manifest: ${response.status} ${response.statusText}`);
  }

  const parsed = (await response.json()) as GithubManifest;
  if (!isPlainObject(parsed) || !isPlainObject(parsed.images)) {
    throw new Error("Invalid image manifest: images must be an object");
  }

  return parsed;
}

function resolveSourceUrl(
  reference: ImageReference,
  entry: ImageStoreEntry,
  fetcher: FetchLike,
): Promise<ResolvedImageSource> {
  if (reference.kind === "local") {
    if (!entry.downloadUrl) {
      throw new Error(
        `Local image ${entry.id} must define downloadUrl in config/images.json so Hydroxide can import it`,
      );
    }

    return Promise.resolve({
      kind: "local",
      url: entry.downloadUrl,
    });
  }

  if (entry.downloadUrl) {
    return Promise.resolve({
      kind: "github",
      url: entry.downloadUrl,
      repository: reference.repository,
      manifestUrl: entry.manifestUrl ?? githubManifestUrl(reference, entry),
      manifestId: entry.manifestId ?? reference.imageId,
    });
  }

  const manifestUrl = githubManifestUrl(reference, entry);
  const manifestId = entry.manifestId ?? reference.imageId;

  return readGithubManifest(manifestUrl, fetcher).then((manifest) => {
    const manifestImage = manifest.images?.[manifestId];
    const downloadUrl = optionalString(manifestImage?.source?.url);

    if (!downloadUrl) {
      throw new Error(
        `Image ${entry.id} was not found in ${manifestUrl} or is missing a source URL`,
      );
    }

    return {
      kind: "github",
      url: downloadUrl,
      repository: reference.repository,
      manifestUrl,
      manifestId,
    };
  });
}

export async function resolveImage(
  imageId: string,
  store: ImageStore,
  fetcher: FetchLike = fetch,
): Promise<ResolvedImage> {
  const reference = parseImageReference(imageId);
  const entry = store.images.find((candidate) => candidate.id === reference.id);

  if (!entry) {
    throw new Error(`Unknown image ID: ${reference.id}`);
  }

  const source = await resolveSourceUrl(reference, entry, fetcher);
  if (!source.url) {
    throw new Error(`Image ${entry.id} did not resolve to a download URL`);
  }

  return {
    id: entry.id,
    pvePath: entry.pvePath,
    downloadUrl: source.url,
    source,
  };
}

import { readFileSync } from "node:fs";

type BuildArtifact = {
  commit?: unknown;
  builtAt?: unknown;
};

export type BuildMetadata = {
  buildCommit: string;
  deployedAt: string;
};

type ResolveBuildMetadataOptions = {
  env?: NodeJS.ProcessEnv;
  artifactUrl?: URL;
  now?: () => Date;
};

const defaultArtifactUrl = new URL("./build-metadata.json", import.meta.url);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBuildArtifact(artifactUrl: URL): BuildArtifact {
  try {
    return JSON.parse(readFileSync(artifactUrl, "utf8")) as BuildArtifact;
  } catch {
    return {};
  }
}

export function resolveBuildMetadata(options: ResolveBuildMetadataOptions = {}): BuildMetadata {
  const env = options.env ?? process.env;
  const artifact = readBuildArtifact(options.artifactUrl ?? defaultArtifactUrl);
  const fallbackTime = (options.now ?? (() => new Date()))().toISOString();

  return {
    buildCommit:
      nonEmptyString(env.RAILWAY_GIT_COMMIT_SHA) ??
      nonEmptyString(env.VERCEL_GIT_COMMIT_SHA) ??
      nonEmptyString(artifact.commit) ??
      "unknown",
    deployedAt: nonEmptyString(artifact.builtAt) ?? fallbackTime
  };
}

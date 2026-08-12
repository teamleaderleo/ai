import { lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';

const nonEmptyStringSchema = z.string().min(1);
const resolutionSchema = z.enum(['480p', '720p', '1080p']);
const modeSchema = z.enum(['edit-video', 'extend-video', 'reference-to-video']);

export type XaiVideoMode = z.infer<typeof modeSchema>;
type XaiVideoResolution = z.infer<typeof resolutionSchema>;

interface XaiVideoSharedOptions {
  pollIntervalMs?: number | null;
  pollTimeoutMs?: number | null;
  resolution?: XaiVideoResolution | null;
}

interface XaiVideoUserOptions {
  /**
   * A unique identifier representing the end user, for abuse monitoring.
   */
  user?: string;
}

interface XaiVideoEditModeOptions
  extends XaiVideoSharedOptions, XaiVideoUserOptions {
  /**
   * Select edit-video mode explicitly for best autocomplete and narrowing.
   */
  mode: 'edit-video';
  /** Source video URL to edit. */
  videoUrl: string;
}

interface XaiVideoExtendModeOptions extends XaiVideoSharedOptions {
  /**
   * Select extend-video mode explicitly for best autocomplete and narrowing.
   */
  mode: 'extend-video';
  /** Source video URL to extend from its last frame. */
  videoUrl: string;
}

type XaiVideoReferenceInputOptions =
  | {
      /** Reference image URLs for R2V generation. */
      referenceImageUrls: string[];
      /** Private xAI Files API image ids for R2V generation. */
      referenceImageFileIds?: string[];
    }
  | {
      /** Reference image URLs for R2V generation. */
      referenceImageUrls?: string[];
      /** Private xAI Files API image ids for R2V generation. */
      referenceImageFileIds: string[];
    };

type XaiVideoReferenceToVideoOptions = XaiVideoSharedOptions &
  XaiVideoUserOptions &
  XaiVideoReferenceInputOptions & {
    /**
     * Select reference-to-video mode explicitly for best autocomplete and narrowing.
     */
    mode: 'reference-to-video';
    /**
     * Preset voice ids (up to 3) that give the subject a voice.
     */
    referenceVoiceIds?: string[];
  };

interface XaiVideoGenerationOptions
  extends XaiVideoSharedOptions, XaiVideoUserOptions {
  mode?: undefined;
  videoUrl?: undefined;
  referenceImageUrls?: undefined;
  referenceImageFileIds?: undefined;
}

interface XaiLegacyEditVideoOptions
  extends XaiVideoSharedOptions, XaiVideoUserOptions {
  /**
   * Legacy backward-compatible shape: omitting `mode` while providing
   * `videoUrl` behaves like edit-video.
   */
  mode?: undefined;
  videoUrl: string;
  referenceImageFileIds?: undefined;
}

type XaiLegacyReferenceToVideoOptions = XaiVideoSharedOptions &
  XaiVideoUserOptions &
  XaiVideoReferenceInputOptions & {
    /**
     * Legacy backward-compatible shape: omitting `mode` while providing
     * reference images behaves like reference-to-video.
     */
    mode?: undefined;
    videoUrl?: undefined;
    /**
     * Preset voice ids (up to 3) that give the subject a voice.
     */
    referenceVoiceIds?: string[];
  };

/**
 * Provider options for xAI video generation.
 *
 * Use the `mode` option to select the operation:
 *
 * - `'edit-video'`         + `videoUrl`                         -- video editing   (`POST /v1/videos/edits`)
 * - `'extend-video'`       + `videoUrl`                         -- video extension (`POST /v1/videos/extensions`)
 * - `'reference-to-video'` + reference image URLs or file IDs -- R2V generation  (`POST /v1/videos/generations`)
 * - no `mode`                                                  -- standard generation from text prompts or image input
 *
 * Runtime remains backward compatible with legacy auto-detected provider
 * options, but the public TypeScript type is intentionally explicit so editors
 * can suggest valid modes and flag invalid field combinations.
 */
export type XaiVideoModelOptions =
  | XaiVideoGenerationOptions
  | XaiVideoEditModeOptions
  | XaiVideoExtendModeOptions
  | XaiVideoReferenceToVideoOptions
  | XaiLegacyEditVideoOptions
  | XaiLegacyReferenceToVideoOptions;

// ── Runtime schemas ───────────────────────────────────────────────────
const baseFields = {
  pollIntervalMs: z.number().positive().nullish(),
  pollTimeoutMs: z.number().positive().nullish(),
  resolution: resolutionSchema.nullish(),
};

const runtimeSchema = z
  .looseObject({
    mode: modeSchema.optional(),
    videoUrl: nonEmptyStringSchema.optional(),
    referenceImageUrls: z
      .array(nonEmptyStringSchema)
      .min(1)
      .max(7)
      .optional(),
    referenceImageFileIds: z
      .array(nonEmptyStringSchema)
      .min(1)
      .max(7)
      .optional(),
    referenceVoiceIds: z.array(nonEmptyStringSchema).max(3).optional(),
    user: z.string().optional(),
    ...baseFields,
  })
  .superRefine((value, ctx) => {
    const referenceCount =
      (value.referenceImageFileIds?.length ?? 0) +
      (value.referenceImageUrls?.length ?? 0);

    if (referenceCount > 7) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceImageFileIds'],
        message: 'xAI reference-to-video supports at most 7 reference images.',
      });
    }
  });

export type XaiParsedVideoModelOptions = z.infer<typeof runtimeSchema>;

export const xaiVideoModelOptionsSchema = lazySchema(() =>
  zodSchema(runtimeSchema),
);

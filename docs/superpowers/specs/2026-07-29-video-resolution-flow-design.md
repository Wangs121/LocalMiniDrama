# Video Resolution Flow Design

## Goal

Separate storyboard generation resolution from final episode export resolution so a selected Seedance generation tier is not overwritten after download, while users can choose a separate FFmpeg export size during episode synthesis.

## Scope

- Move the existing video generation resolution control out of the project-level video configuration and into the storyboard-video generation area.
- Keep this setting as the current episode's shared generation setting; every storyboard video creation request sends the selected tier to the configured provider.
- Stop post-download normalization of individual storyboard video files. Stored storyboard media must retain the provider's delivered dimensions.
- Add an export-resolution control beside the episode synthesis action.
- Export choices are 480p, 720p, 1080p, 1440p, 2160p (4K), and custom dimensions.
- Custom export dimensions use the project's aspect ratio, require a positive even pixel value for the editable dimension, and reject a longest edge above 3840 pixels.
- The existing merge-options request object carries the export setting through the finalization endpoint to the FFmpeg merge service.
- During synthesis, FFmpeg re-encodes the merged episode to the requested export dimensions. The filter preserves aspect ratio and adds black padding only when input clips do not exactly match the target frame.

## Non-goals

- No AI upscaling or restoration call is added in this change.
- No per-storyboard resolution control is added.
- Existing completed videos are not retroactively changed.
- Provider-specific resolution support remains unchanged; an unsupported generation tier continues to be handled by the provider as it is today.

## User Interface

The existing `480p / 720p / 1080p` control is relabeled as storyboard generation resolution and placed with the video-generation controls. It controls only requests created through the storyboard video actions, including batch and one-click workflows.

The episode synthesis section gets a distinct export-resolution selector. Preset labels represent the long edge of the final output. The backend derives exact width and height from the project aspect ratio. Selecting Custom exposes one numeric input for the long edge; the other dimension is calculated and shown read-only. The UI blocks submission when the longest edge is above 3840 or cannot produce even dimensions.

## Data Flow

1. Storyboard video creation submits `resolution` exactly as it does now.
2. `video_generations.resolution` records that requested provider tier.
3. The downloaded video is stored unchanged; no per-clip FFmpeg scale or padding runs.
4. Episode finalization sends `export_resolution` inside the finalization request and persists it in `video_merges.merge_options`.
5. The merge service builds the target dimensions from the export setting and episode aspect ratio, then runs a re-encoding FFmpeg merge path that scales and pads each input consistently.
6. Existing post-processing for dialogue, narration, and watermark continues after export normalization and retains the selected dimensions.

## Error Handling

- Invalid export values are rejected before a merge task is created, with a clear API error.
- If FFmpeg is unavailable or export re-encoding fails, the merge task fails rather than silently returning a mismatched source clip.
- Existing fallback behavior for a merge that cannot be constructed remains only for cases without an export-resolution request; selecting an export resolution requires an actual FFmpeg output.

## Testing

- Unit-test resolution-to-dimensions conversion for portrait, landscape, square, preset, custom, invalid, and 3840-limit cases.
- Unit-test that storyboard download processing no longer invokes normalization.
- Unit-test finalization propagation into `merge_options`.
- Unit-test merge command construction includes the scale-and-pad filter for an export setting and preserves the copy-concat path when no export setting is provided.

## Future Extension

AI quality enhancement can be introduced as an explicit, optional export post-processing stage after FFmpeg has produced the requested dimensions. It will need its own provider/model selection, cost disclosure, asynchronous task progress, and failure policy; none of those concerns are part of this change.

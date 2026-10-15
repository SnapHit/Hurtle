# Music

Five original tracks in `v2/`, played in the order they are numbered.
Track 1 is the default every player starts on.

Tracks 1 and 3 were swapped on 15 August 2026, by renaming the files as
this note says to. The storage key was bumped to hurtle_track_v2 in the
same change: it stores a track number, and leaving it alone would have
handed anyone who had chosen track 3 a different song under the same
number.

On 15 October 2026 track 3 moved to first place, and old 1 and 2 moved
down one (old 3, 1, 2, 4, 5 became new 1 to 5). The storage key went to
hurtle_track_v3 for the same reason as before.

Reordering the playlist is done by renaming files, not by a mapping
table in code. A mapping table is something a person has to reason
about in six months.

**But never give an existing URL different audio.** Since September,
`_headers` serves `/music/*` as immutable for a year, so a browser that
already holds `track-1.m4a` will keep playing the old song under that
name. A reorder therefore moves all five files into a new folder
(`v2/` now, `v3/` next time) and points `REC_PATH` in game.js and the
paths in tools/build_portal.py at it. The old folder is deleted, not
kept.

## Encoding

Masters are MP3 at 195 to 197 kbps. Encoded with:

    ffmpeg -i source.mp3 -vn -map_metadata -1 -c:a aac -b:a 112k \
           -ar 44100 -ac 2 -movflags +faststart track-N.m4a

Every flag earns its place:

- `-vn` strips embedded album art. All five masters carried an mjpeg
  stream. Left in, it bloats the file and can break the container.
- `-map_metadata -1` clears tags.
- `-ar 44100` because track 4's master was 48 kHz and the rest were
  44.1. Consistency matters more than the source rate.
- `-movflags +faststart` puts the index before the audio so playback
  can begin before the download finishes. Without it a three minute
  track must download in full before a note is heard.

112 kbps was chosen because it was measured against masters of this
exact bitrate on another project and judged transparent on a phone
speaker. This is a second lossy pass, MP3 to AAC, so do not re-encode
these files again. Go back to the MP3 masters if a change is needed.

Verified after encoding: loudness drift 0.02 to 0.07 dB, duration
within 40 ms, one audio stream each, moov before mdat.

Total 14.94 MB, from 25.49 MB of MP3.

## Do not commit the masters

The MP3s are 25 MB and git history is permanent. Anything committed
here is in every clone forever, even after it is deleted.

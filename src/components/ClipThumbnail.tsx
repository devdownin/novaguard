import React, { ReactNode, useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

/**
 * The still kept for a clip, and what stands in when there is none.
 *
 * Every card used to draw the same gradient and the same little rectangle, so
 * a history of thirty detections was thirty identical rows and the only way to
 * tell one from another was to open it. The still is taken as the clip opens,
 * which is the frame that says why the clip exists.
 *
 * A missing still is ordinary rather than exceptional — a clip recorded with
 * the screen off has no preview to snapshot — so the placeholder is a first
 * class state, and a file that has since been reclaimed falls back to it too
 * rather than leaving a hole in the row.
 */
export function ClipThumbnail({
  path, colors, start, end, placeholder,
}: {
  path: string | null;
  colors: [string, string];
  start: { x: number; y: number };
  end: { x: number; y: number };
  placeholder?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  // Cards are recycled by the list, so a failure has to be forgotten when the
  // component is handed a different clip — otherwise one deleted still would
  // blank every card that reused its row.
  useEffect(() => { setFailed(false); }, [path]);

  const usable = path != null && !failed;

  return (
    <>
      <LinearGradient colors={colors} start={start} end={end} style={StyleSheet.absoluteFill} />
      {usable ? (
        <Image
          source={{ uri: `file://${path}` }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : placeholder}
    </>
  );
}

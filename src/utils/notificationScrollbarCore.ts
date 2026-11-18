export type ScrollbarMetricsInput = {
  viewportHeight: number;
  contentHeight: number;
  scrollOffset: number;
  minThumbHeight?: number;
  trackPadding?: number;
};

export type ScrollbarMetrics = {
  visible: boolean;
  trackHeight: number;
  thumbHeight: number;
  thumbTop: number;
};

/**
 * Computes pure track & thumb geometry for the NotificationCenterModal right-side scrollbar.
 */
export function computeScrollbarMetrics({
  viewportHeight,
  contentHeight,
  scrollOffset,
  minThumbHeight = 28,
  trackPadding = 4,
}: ScrollbarMetricsInput): ScrollbarMetrics {
  if (
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(contentHeight) ||
    viewportHeight <= 0 ||
    contentHeight <= viewportHeight + 2
  ) {
    return {
      visible: false,
      trackHeight: 0,
      thumbHeight: 0,
      thumbTop: trackPadding,
    };
  }

  const trackHeight = Math.max(0, viewportHeight - trackPadding * 2);
  if (trackHeight <= 0) {
    return {
      visible: false,
      trackHeight: 0,
      thumbHeight: 0,
      thumbTop: trackPadding,
    };
  }

  const proportional = (viewportHeight / contentHeight) * trackHeight;
  const thumbHeight = Math.max(
    Math.min(minThumbHeight, trackHeight),
    Math.min(trackHeight, proportional)
  );
  const maxScroll = Math.max(1, contentHeight - viewportHeight);
  const clampedOffset = Math.max(
    0,
    Math.min(maxScroll, Number.isFinite(scrollOffset) ? scrollOffset : 0)
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = trackPadding + (clampedOffset / maxScroll) * maxThumbTop;

  return {
    visible: true,
    trackHeight,
    thumbHeight,
    thumbTop,
  };
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardEvent,
  Platform,
  ScrollView,
  TextInput,
} from 'react-native';

export type ScrollViewRefTarget = React.ComponentRef<typeof ScrollView>;
export type TextInputRefTarget = React.ComponentRef<typeof TextInput>;

type MeasurableTarget = {
  measureInWindow?: (
    cb: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

type FocusRequest = {
  input: TextInputRefTarget | null;
  extraBottomClearance: number;
};

/**
 * Coordinates ScrollView auto-scrolling and IME bottom spacer on Android/iOS
 * without conflicting with `windowSoftInputMode="adjustResize"` or edge-to-edge layouts.
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollViewRefTarget | null>(null);
  const scrollOffsetYRef = useRef(0);
  const keyboardTopScreenYRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<FocusRequest | null>(null);
  const [bottomSpacer, setBottomSpacer] = useState(0);

  const performScrollIntoView = useCallback(
    (
      input: TextInputRefTarget | null,
      extraBottomClearance: number,
      keyboardTopY: number
    ) => {
      const scrollNode = scrollRef.current as unknown as (MeasurableTarget & {
        scrollTo?: (opts: { y: number; animated?: boolean }) => void;
      }) | null;
      const inputNode = input as unknown as MeasurableTarget | null;

      if (
        !scrollNode ||
        !inputNode ||
        typeof scrollNode.measureInWindow !== 'function' ||
        typeof inputNode.measureInWindow !== 'function'
      ) {
        return;
      }

      scrollNode.measureInWindow((_sx, sy, _sw, sh) => {
        inputNode.measureInWindow?.((_ix, iy, _iw, ih) => {
          if (sh <= 0) return;
          const visibleBottom =
            Math.min(sy + sh, keyboardTopY) - extraBottomClearance;
          const inputBottom = iy + ih;

          if (inputBottom > visibleBottom) {
            const delta = inputBottom - visibleBottom;
            scrollNode.scrollTo?.({
              y: Math.max(0, scrollOffsetYRef.current + delta),
              animated: true,
            });
          } else if (iy < sy + 12) {
            const deltaUp = sy + 12 - iy;
            scrollNode.scrollTo?.({
              y: Math.max(0, scrollOffsetYRef.current - deltaUp),
              animated: true,
            });
          }
        });
      });
    },
    []
  );

  const recomputeSpacerForKeyboard = useCallback((keyboardTopY: number) => {
    const scrollNode = scrollRef.current as unknown as MeasurableTarget | null;
    if (!scrollNode || typeof scrollNode.measureInWindow !== 'function') {
      return;
    }

    scrollNode.measureInWindow((_sx, sy, _sw, sh) => {
      const scrollBottom = sy + sh;
      const overlap = Math.max(0, Math.round(scrollBottom - keyboardTopY));
      setBottomSpacer(overlap > 0 ? overlap + 20 : 12);
    });
  }, []);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onKeyboardShow = (event: KeyboardEvent) => {
      const windowHeight = Dimensions.get('window').height;
      const coordY = event.endCoordinates?.screenY;
      const coordH = event.endCoordinates?.height ?? 0;
      const keyboardTopY =
        typeof coordY === 'number' && coordY > 0 && coordY < windowHeight
          ? coordY
          : Math.max(120, windowHeight - coordH);

      keyboardTopScreenYRef.current = keyboardTopY;
      setTimeout(() => {
        if (keyboardTopScreenYRef.current !== null) {
          recomputeSpacerForKeyboard(keyboardTopScreenYRef.current);
        }
      }, 40);

      if (pendingFocusRef.current?.input) {
        const req = pendingFocusRef.current;
        setTimeout(() => {
          performScrollIntoView(
            req.input,
            req.extraBottomClearance,
            keyboardTopScreenYRef.current ?? keyboardTopY
          );
        }, 100);
      }
    };

    const onKeyboardHide = () => {
      keyboardTopScreenYRef.current = null;
      pendingFocusRef.current = null;
      setBottomSpacer(0);
    };

    const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [performScrollIntoView, recomputeSpacerForKeyboard]);

  const handleScroll = useCallback((offsetY: number) => {
    scrollOffsetYRef.current = offsetY;
  }, []);

  const handleScrollLayout = useCallback(() => {
    if (keyboardTopScreenYRef.current !== null) {
      recomputeSpacerForKeyboard(keyboardTopScreenYRef.current);
    }
  }, [recomputeSpacerForKeyboard]);

  const focusInput = useCallback(
    (input: TextInputRefTarget | null, extraBottomClearance = 36) => {
      pendingFocusRef.current = { input, extraBottomClearance };
      if (keyboardTopScreenYRef.current !== null && input) {
        const topY = keyboardTopScreenYRef.current;
        setTimeout(() => {
          performScrollIntoView(input, extraBottomClearance, topY);
        }, 80);
      }
    },
    [performScrollIntoView]
  );

  return {
    scrollRef,
    bottomSpacer,
    handleScroll,
    handleScrollLayout,
    focusInput,
  };
}

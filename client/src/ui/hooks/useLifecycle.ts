import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Returns a stable callback function that always sees the latest props and state,
 * but whose function reference remains strictly stable across all renders.
 * (Similar to React RFC useEffectEvent).
 */
export function useStableCallback<Args extends readonly unknown[], Return>(
  callback: (...args: Args) => Return
): (...args: Args) => Return {
  const callbackRef = useRef<(...args: Args) => Return>(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  const [stableFn] = useState(
    () =>
      ((...args: Args) => {
        return callbackRef.current(...args);
      })
  );

  return stableFn;
}

/**
 * Lifecycle hook that automatically attaches an event listener to a target
 * (window, document, HTMLElement, or EventTarget) and guarantees cleanup on unmount or target change.
 * Uses useStableCallback internally so the listener is never re-attached unnecessarily.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  target: Window | null | undefined,
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document | null | undefined,
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): void;
export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null | undefined,
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): void;
export function useEventListener(
  target: EventTarget | null | undefined,
  eventName: string,
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions
): void;
export function useEventListener(
  target: EventTarget | null | undefined,
  eventName: string,
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions
): void {
  const savedHandler = useStableCallback(handler);

  useEffect(() => {
    if (!target || typeof target.addEventListener !== 'function') {
      return undefined;
    }

    const listener: EventListener = (event) => {
      savedHandler(event);
    };

    target.addEventListener(eventName, listener, options);
    return () => {
      target.removeEventListener(eventName, listener, options);
    };
  }, [target, eventName, options, savedHandler]);
}

/**
 * Hook that returns an AbortSignal tied to the component's lifecycle.
 * The signal automatically aborts when the component unmounts, cancelling
 * all active fetch requests and async tasks.
 */
export function useLifecycleSignal(): AbortSignal {
  const [controller] = useState(() => new AbortController());

  useEffect(() => {
    return () => {
      controller.abort();
    };
  }, [controller]);

  return controller.signal;
}

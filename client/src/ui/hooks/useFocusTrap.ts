import { useLayoutEffect, useRef } from 'preact/hooks';

export interface UseFocusTrapOptions {
  /** Whether the focus trap is active (e.g. modal isOpen) */
  readonly isActive: boolean;
  /** Optional container ref. If not provided, an internal ref is created and returned */
  readonly containerRef?: { current: HTMLElement | null } | undefined;
  /** Optional element to focus initially */
  readonly initialFocusRef?: { current: HTMLElement | null } | undefined;
  /** Whether to restore focus to previously active element on unmount/close (default: true) */
  readonly restoreFocus?: boolean | undefined;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps Tab and Shift+Tab keyboard focus within a modal container,
 * preventing focus leakage into background document elements while active.
 */
export function useFocusTrap(
  options: UseFocusTrapOptions
): { current: HTMLElement | null } {
  const defaultRef = useRef<HTMLElement | null>(null);
  const containerRef = options.containerRef ?? defaultRef;
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!options.isActive) {
      return undefined;
    }

    if (typeof document !== 'undefined') {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    }

    const container = containerRef.current;
    if (container) {
      const focusTarget =
        options.initialFocusRef?.current ??
        (container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const focusable = Array.from(
        currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => {
        // Exclude elements that are hidden or display: none
        if (typeof window !== 'undefined') {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }
        }
        return true;
      });

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !currentContainer.contains(document.activeElement)
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          !currentContainer.contains(document.activeElement)
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', handleKeyDown);
      }
      if (options.restoreFocus !== false && previousActiveElementRef.current) {
        try {
          previousActiveElementRef.current.focus();
        } catch {
          // Ignore if element was removed from DOM
        }
      }
    };
  }, [options.isActive, options.restoreFocus, containerRef, options.initialFocusRef]);

  return containerRef;
}

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import {
  useEventListener,
  useLifecycleSignal,
  useStableCallback,
} from '../../src/ui/hooks/useLifecycle.js';

const flushTicks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

describe('Zero-Leak Lifecycle Hooks (useLifecycle.ts)', () => {
  describe('useStableCallback', () => {
    it('returns a stable function reference that calls the latest callback closure', async () => {
      let currentVal = 10;
      let capturedStableFn: ((extra: number) => number) | undefined;

      const TestComp = ({ val }: { readonly val: number }) => {
        const fn = useStableCallback((extra: number) => val + extra);
        capturedStableFn = fn;
        return h('div', null, `Val: ${val}`);
      };

      const container = document.createElement('div');
      render(h(TestComp, { val: 10 }), container);
      await flushTicks();

      const firstFnRef = capturedStableFn;
      expect(firstFnRef).toBeDefined();
      if (firstFnRef !== undefined) {
        expect(firstFnRef(5)).toBe(15);
      }

      // Re-render with new prop
      currentVal = 25;
      render(h(TestComp, { val: currentVal }), container);
      await flushTicks();

      expect(capturedStableFn).toBe(firstFnRef); // strictly same function reference!
      if (capturedStableFn !== undefined) {
        expect(capturedStableFn(5)).toBe(30); // sees latest closure value!
      }
    });
  });

  describe('useEventListener', () => {
    it('attaches listener to target and removes it upon unmount', async () => {
      const addMock = vi.fn();
      const removeMock = vi.fn();
      const mockTarget = {
        addEventListener: addMock,
        removeEventListener: removeMock,
      } as unknown as EventTarget;

      const handler = vi.fn();

      const TestComp = ({ active }: { readonly active: boolean }) => {
        useEventListener(active ? mockTarget : null, 'custom-event', handler);
        return h('div', null, 'Event test');
      };

      const container = document.createElement('div');
      render(h(TestComp, { active: true }), container);
      await flushTicks();

      expect(addMock).toHaveBeenCalledTimes(1);
      expect(addMock).toHaveBeenCalledWith(
        'custom-event',
        expect.any(Function),
        undefined
      );

      // Unmount by rendering null
      render(null, container);
      await flushTicks();

      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(removeMock).toHaveBeenCalledWith(
        'custom-event',
        expect.any(Function),
        undefined
      );
    });

    it('does not re-subscribe listener if handler reference changes across renders', async () => {
      const addMock = vi.fn();
      const removeMock = vi.fn();
      const mockTarget = {
        addEventListener: addMock,
        removeEventListener: removeMock,
      } as unknown as EventTarget;

      const TestComp = ({ count }: { readonly count: number }) => {
        useEventListener(mockTarget, 'click', () => {
          // handler closure changes every render
          void count;
        });
        return h('div', null, `Count: ${count}`);
      };

      const container = document.createElement('div');
      render(h(TestComp, { count: 1 }), container);
      await flushTicks();
      expect(addMock).toHaveBeenCalledTimes(1);

      // Re-render 5 times with changing props
      for (let i = 2; i <= 6; i++) {
        render(h(TestComp, { count: i }), container);
        await flushTicks();
      }

      // Listener was attached ONCE, not removed and re-added 5 times
      expect(addMock).toHaveBeenCalledTimes(1);
      expect(removeMock).toHaveBeenCalledTimes(0);
    });
  });

  describe('useLifecycleSignal', () => {
    it('returns an AbortSignal that aborts on component unmount', async () => {
      let capturedSignal: AbortSignal | undefined;

      const TestComp = () => {
        const signal = useLifecycleSignal();
        capturedSignal = signal;
        return h('div', null, 'Signal test');
      };

      const container = document.createElement('div');
      render(h(TestComp, {}), container);
      await flushTicks();

      expect(capturedSignal).toBeDefined();
      const signalRef1 = capturedSignal;
      if (signalRef1) {
        expect(signalRef1.aborted).toBe(false);
      }

      // Unmount component
      render(null, container);
      await flushTicks();

      const signalRef2 = capturedSignal;
      if (signalRef2) {
        expect(signalRef2.aborted).toBe(true);
      }
    });
  });
});

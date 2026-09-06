// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { useFocusTrap } from '../src/ui/hooks/useFocusTrap.js';
import { NewIssueModal } from '../src/ui/NewIssueModal.js';
import { FileFinder } from '../src/ui/FileFinder.js';

interface TestModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

function TestModal({ isOpen, onClose }: TestModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useFocusTrap({
    isActive: isOpen,
    containerRef: modalRef,
    initialFocusRef: firstInputRef,
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" data-testid="test-modal">
        <input ref={firstInputRef} data-testid="first-input" type="text" />
        <button data-testid="middle-btn" type="button">
          Middle
        </button>
        <button data-testid="last-btn" type="button">
          Close
        </button>
      </div>
    </div>
  );
}

describe('Modal Focus Trapping (useFocusTrap)', () => {
  let rootContainer: HTMLDivElement;
  let outsideButton: HTMLButtonElement;

  beforeEach(() => {
    rootContainer = document.createElement('div');
    document.body.appendChild(rootContainer);

    outsideButton = document.createElement('button');
    outsideButton.setAttribute('data-testid', 'outside-button');
    outsideButton.textContent = 'Background Control';
    document.body.appendChild(outsideButton);
    outsideButton.focus();
  });

  afterEach(() => {
    render(null, rootContainer);
    rootContainer.remove();
    outsideButton.remove();
  });

  const noop = (): void => {
    // No-op for modal testing callbacks
  };

  it('autofocuses initial focus target when modal is active', () => {
    render(<TestModal isOpen={true} onClose={noop} />, rootContainer);

    const firstInput = rootContainer.querySelector<HTMLInputElement>('[data-testid="first-input"]');
    expect(document.activeElement).toBe(firstInput);
  });

  it('wraps focus from last element to first element on Tab key', () => {
    render(<TestModal isOpen={true} onClose={noop} />, rootContainer);

    const firstInput = rootContainer.querySelector<HTMLInputElement>('[data-testid="first-input"]');
    const lastBtn = rootContainer.querySelector<HTMLButtonElement>('[data-testid="last-btn"]');

    expect(lastBtn).not.toBeNull();
    lastBtn?.focus();
    expect(document.activeElement).toBe(lastBtn);

    // Simulate Tab key on the last focusable element
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstInput);
  });

  it('wraps focus from first element to last element on Shift+Tab key', () => {
    render(<TestModal isOpen={true} onClose={noop} />, rootContainer);

    const firstInput = rootContainer.querySelector<HTMLInputElement>('[data-testid="first-input"]');
    const lastBtn = rootContainer.querySelector<HTMLButtonElement>('[data-testid="last-btn"]');

    firstInput?.focus();
    expect(document.activeElement).toBe(firstInput);

    // Simulate Shift+Tab key on the first focusable element
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabEvent);

    expect(shiftTabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastBtn);
  });

  it('restores focus to previously active element upon closing', () => {
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    // Open modal
    render(<TestModal isOpen={true} onClose={noop} />, rootContainer);
    const firstInput = rootContainer.querySelector<HTMLInputElement>('[data-testid="first-input"]');
    expect(document.activeElement).toBe(firstInput);

    // Close modal
    render(<TestModal isOpen={false} onClose={noop} />, rootContainer);
    expect(document.activeElement).toBe(outsideButton);
  });

  it('NewIssueModal contains role="dialog" and aria-modal="true"', () => {
    render(<NewIssueModal isOpen={true} onClose={noop} />, rootContainer);

    const modal = rootContainer.querySelector<HTMLDivElement>('[data-testid="new-issue-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('role')).toBe('dialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
  });

  it('FileFinder modal contains role="dialog" and aria-modal="true"', () => {
    render(<FileFinder isOpen={true} onClose={noop} files={[]} onSelectFile={noop} />, rootContainer);

    const modal = rootContainer.querySelector<HTMLDivElement>('.finder-modal-content');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('role')).toBe('dialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
  });
});

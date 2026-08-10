import {
  getCurrentInstance,
  onUnmounted,
  watch,
  type Ref,
  type WatchStopHandle,
} from "vue";

import { appStateStore } from "@/stores/appState";

export function useModal() {
  const appState = appStateStore();

  function registerOpenModal(
    id: string | number,
    disableClose = false,
    lockScroll = true,
  ) {
    // console.log('register', id)
    const thisId = id.toString();
    const registered = appState.modalPool.includes(thisId);
    if (appState.modalPoolDisabled == false && disableClose) {
      appState.modalPoolDisabled = true;
    }
    if (!registered) {
      appState.modalPool.push(thisId);
    }
    if (lockScroll && !appState.scrollLockPool.includes(thisId)) {
      appState.scrollLockPool.push(thisId);
    }
  }

  function unregisterModal(id: string | number, disableClose = false) {
    // console.log('unregister', id)
    const thisId = id.toString();
    if (appState.modalPoolDisabled == true && disableClose) {
      appState.modalPoolDisabled = false;
    }
    appState.modalPool = appState.modalPool.filter((item) => {
      return item !== thisId;
    });
    appState.scrollLockPool = appState.scrollLockPool.filter((item) => {
      return item !== thisId;
    });
  }
  return {
    registerOpenModal,
    unregisterModal,
  };
}

export interface ModalRegistrationOptions {
  /** Pool identity. Read once, when the overlay registers. */
  id: () => string | number;
  /** Whether the overlay is currently on screen. */
  isOpen: () => boolean;
  /**
   * Called when ESC has popped this overlay's entry. May be async — the modals
   * dismiss by animating out — and the result is deliberately not awaited: the
   * pool entry is released before this runs, so nothing waits on the animation.
   */
  onDismiss: () => void | Promise<void>;
  /** True for a non-dismissible overlay, which suppresses ESC app-wide. */
  disableClose?: () => boolean;
  /**
   * Whether the overlay locks page scroll while open. Menus, dropdowns and
   * popovers pass false — they join the dismissal order without taking the
   * scrollbar away from the page behind them.
   */
  lockScroll?: boolean;
}

/**
 * Join an overlay to the shared dismissal pool so the global ESC handler in
 * App.vue closes it (ADR 015). The single implementation of the registry
 * invariant — every dismissible overlay goes through here.
 *
 * Prefer `useModalToggle` when the overlay owns a writable `open` ref. This
 * lower-level form exists for overlays whose open state is a prop they cannot
 * write and whose dismissal is a function call rather than clearing a ref —
 * `AppModal` and `ModalSecondary`, which dismiss via `triggerClose()`.
 */
export function useModalRegistration(options: ModalRegistrationOptions) {
  const appState = appStateStore();
  const { registerOpenModal, unregisterModal } = useModal();
  const lockScroll = options.lockScroll ?? true;

  // The pool entry this overlay currently holds, or null when it holds none.
  // Doubles as the registered guard, so the two can never disagree: without it
  // the dismissal watcher below cannot tell "ESC popped me, so close" from
  // "opened a moment ago and not registered yet", and would slam a just-opened
  // overlay shut. Capturing id and disableClose at registration also keeps
  // release symmetric with register, so `modalPoolDisabled` cannot stick.
  let entry: { id: string; disableClose: boolean } | null = null;

  function release() {
    if (!entry) {
      return;
    }
    unregisterModal(entry.id, entry.disableClose);
    entry = null;
  }

  watch(
    options.isOpen,
    (isOpen) => {
      if (isOpen) {
        const id = options.id().toString();
        const disableClose = options.disableClose?.() ?? false;
        registerOpenModal(id, disableClose, lockScroll);
        entry = { id, disableClose };
      } else {
        release();
      }
    },
    // Sync, not the default pre-flush. Callers flip the open state synchronously
    // from a click handler or a prop patch, so a deferred callback would leave
    // the overlay open but unregistered until the next tick — and any pool
    // change arriving in that window reads as "this was dismissed".
    { flush: "sync" },
  );

  watch(
    () => appState.modalPool,
    (modalPool) => {
      if (entry && options.isOpen() && !modalPool.includes(entry.id)) {
        // Release before dismissing: ESC pops modalPool only, so the scroll-lock
        // entry still has to be cleared, and dismissal may be asynchronous
        // (triggerClose animates first) which would otherwise fire twice.
        release();
        void options.onDismiss();
      }
    },
    // modalPool is mutated in place (push/pop), so a reference-equality watch
    // would miss those changes — watch its contents deeply.
    { deep: true },
  );

  // An overlay destroyed while still open would otherwise leave a stale id
  // behind, and the next ESC press would be absorbed popping it.
  onUnmounted(release);
}

/**
 * Join an overlay that owns a writable visibility ref to the dismissal pool.
 * The common case; a thin wrapper over `useModalRegistration`.
 *
 * @param open the overlay's own visibility ref; set to false when ESC pops it
 * @param options.id pool identity, defaulting to the component instance uid so
 *   several instances of the same component each get their own entry
 * @param options.lockScroll see `ModalRegistrationOptions`
 * @param options.disableClose see `ModalRegistrationOptions`
 */
export function useModalToggle(
  open: Ref<boolean>,
  options: {
    id?: string | number;
    lockScroll?: boolean;
    disableClose?: () => boolean;
  } = {},
) {
  const id = (options.id ?? getCurrentInstance()?.uid ?? "").toString();

  useModalRegistration({
    id: () => id,
    isOpen: () => open.value,
    onDismiss: () => {
      open.value = false;
    },
    disableClose: options.disableClose,
    lockScroll: options.lockScroll,
  });
}

/**
 * Own the `overflow-hidden` body class for the whole app, driven by the
 * scroll-lock pool. Called once from App.vue.
 *
 * Deliberately a single owner: this used to live in a modalPool watcher inside
 * both AppModal and ModalSecondary, which ran in every mounted instance — a
 * hidden modal was enough to lock scroll for an unrelated overlay (ADR 015).
 */
export function useBodyScrollLock(): WatchStopHandle {
  const appState = appStateStore();

  return watch(
    () => appState.scrollLockPool.length,
    (locked) => {
      if (locked > 0) {
        document.body.classList.add("overflow-hidden");
      } else {
        document.body.classList.remove("overflow-hidden");
      }
    },
    { immediate: true },
  );
}

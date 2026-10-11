/** How long the pointer must rest before it hides. */
export const CURSOR_IDLE_MS = 2000

export interface CursorHider {
  /** Start (full screen entered) or stop (left) hiding; stopping shows it at once. */
  setActive(on: boolean): void
}

/**
 * Hides the pointer over `win` after it rests for CURSOR_IDLE_MS, by putting
 * `.cursor-hidden` on its body (see the CSS). `cursor: none` leaves `:hover`
 * alone, so a hover title under the resting pointer stays up. Movement, a mouse
 * button or the wheel brings it back; keys don't. `hold()` vetoes hiding while
 * the pointer is in use (toolbar showing, scrubbing).
 */
export function autoHideCursor(win: Window, hold: () => boolean = () => false): CursorHider {
  const body = win.document.body
  let active = false
  let timer = 0
  let lastX = NaN
  let lastY = NaN

  const arm = (): void => {
    clearTimeout(timer)
    if (!active) return
    timer = window.setTimeout(() => {
      if (active && !hold()) body.classList.add('cursor-hidden')
    }, CURSOR_IDLE_MS)
  }
  const wake = (): void => {
    body.classList.remove('cursor-hidden')
    arm()
  }

  win.addEventListener('mousemove', (e) => {
    // A mousemove can arrive for a pointer that hasn't moved (e.g. when the
    // window changes under it); only real movement counts as use.
    if (e.screenX === lastX && e.screenY === lastY) return
    lastX = e.screenX
    lastY = e.screenY
    wake()
  })
  win.addEventListener('mousedown', wake)
  win.addEventListener('wheel', wake, { passive: true })

  return {
    setActive(on: boolean): void {
      active = on
      wake()
    }
  }
}

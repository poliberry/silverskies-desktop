import { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc-client";

/** Every window is frameless (see electron/main.ts's createAppWindow) and
 * draws its own titlebar — this backs the three buttons behind it
 * (WindowControlButtons.tsx), scoped automatically to whichever window the
 * calling renderer is running in. */
export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void ipc.windowControls.isMaximized().then(setIsMaximized);
    return ipc.windowControls.onMaximizeChanged(setIsMaximized);
  }, []);

  return {
    isMaximized,
    minimize: () => void ipc.windowControls.minimize(),
    toggleMaximize: () => void ipc.windowControls.toggleMaximize(),
    close: () => void ipc.windowControls.close(),
  };
}

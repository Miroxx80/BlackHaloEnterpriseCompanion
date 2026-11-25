// Brücke zwischen Web-Shell und Desktop-App. Bewusst minimal: Die Seite bekommt keinen Zugriff
// auf Node oder Electron, nur diese eine Funktion.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bhDesktop', {
  /** false: Das Fenster nimmt keinen Fokus an, das Spiel behält die Tastatur. */
  setFocusable(value: boolean) {
    if (typeof value === 'boolean') ipcRenderer.send('bh:set-focusable', value);
  },
});

import { ipcRenderer, contextBridge, webUtils } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('toolkit', {
  pickPaths: () => ipcRenderer.invoke('toolkit:pick-paths'),
  startJob: (payload: { name: string; operation: string; paths: string[]; renamePattern?: string }) =>
    ipcRenderer.invoke('toolkit:start-job', payload),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getImagePreview: (targetPath: string) => ipcRenderer.invoke('toolkit:get-image-preview', targetPath),
  getPdfPreview: (targetPath: string) => ipcRenderer.invoke('toolkit:get-pdf-preview', targetPath),
  getPdfBuffer: (targetPath: string) => ipcRenderer.invoke('toolkit:get-pdf-buffer', targetPath),
  revealInFolder: (targetPath: string) => ipcRenderer.invoke('toolkit:reveal-in-folder', targetPath),
  startNativeDrag: (paths: string[]) => ipcRenderer.send('toolkit:start-native-drag', { paths }),
  onJobProgress: (
    listener: (payload: {
      id: string
      name: string
      operation: string
      totalFiles: number
      progress: number
      status: 'idle' | 'running' | 'success' | 'error'
      createdAt: string
    }) => void,
  ) => {
    const wrappedListener = (_event: unknown, payload: {
      id: string
      name: string
      operation: string
      totalFiles: number
      progress: number
      status: 'idle' | 'running' | 'success' | 'error'
      createdAt: string
    }) => listener(payload)

    ipcRenderer.on('toolkit:job-progress', wrappedListener)
    return () => ipcRenderer.off('toolkit:job-progress', wrappedListener)
  },
  onJobResult: (
    listener: (payload: { id: string; outputPath: string; totalFiles: number; paths?: string[] }) => void,
  ) => {
    const wrappedListener = (
      _event: unknown,
      payload: { id: string; outputPath: string; totalFiles: number; paths?: string[] },
    ) =>
      listener(payload)

    ipcRenderer.on('toolkit:job-result', wrappedListener)
    return () => ipcRenderer.off('toolkit:job-result', wrappedListener)
  },
  onJobError: (
    listener: (payload: { id: string; operation: string; message: string; detail: string; at: string }) => void,
  ) => {
    const wrappedListener = (
      _event: unknown,
      payload: { id: string; operation: string; message: string; detail: string; at: string },
    ) => listener(payload)

    ipcRenderer.on('toolkit:job-error', wrappedListener)
    return () => ipcRenderer.off('toolkit:job-error', wrappedListener)
  },
  organizer: {
    getHome: () => ipcRenderer.invoke('toolkit:organizer-get-home'),
    pickFolder: () => ipcRenderer.invoke('toolkit:organizer-pick-folder'),
    list: (targetPath: string) => ipcRenderer.invoke('toolkit:organizer-list', targetPath),
    createFolder: (payload: { parentPath: string; name: string }) =>
      ipcRenderer.invoke('toolkit:organizer-create-folder', payload),
    renamePath: (payload: { targetPath: string; newName: string }) =>
      ipcRenderer.invoke('toolkit:organizer-rename-path', payload),
    movePaths: (payload: { sourcePaths: string[]; destinationDir: string }) =>
      ipcRenderer.invoke('toolkit:organizer-move-paths', payload),
    deletePaths: (payload: { paths: string[] }) =>
      ipcRenderer.invoke('toolkit:organizer-delete-paths', payload),
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)

const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods yang memungkinkan renderer process
// untuk berkomunikasi dengan main process secara aman
contextBridge.exposeInMainWorld("electronAPI", {
  // Serial Port APIs
  getSerialPorts: () => ipcRenderer.invoke("get-serial-ports"),

  getAllSerialPorts: () => ipcRenderer.invoke("get-all-serial-ports"), // Debug function

  openSerialPort: (portPath, baudRate) =>
    ipcRenderer.invoke("open-serial-port", portPath, baudRate),

  closeSerialPort: () => ipcRenderer.invoke("close-serial-port"),

  startSerialReading: () => ipcRenderer.invoke("start-serial-reading"),
  // Event listeners
  onSerialData: (callback) => {
    ipcRenderer.on("serial-data-received", (event, data) => callback(data));
  },

  removeSerialDataListener: () => {
    ipcRenderer.removeAllListeners("serial-data-received");
  },

  // Photo Save Folder APIs (Electron only)
  getPhotoSaveFolder: () => ipcRenderer.invoke("get-photo-save-folder"),
  setPhotoSaveFolder: (folderPath) =>
    ipcRenderer.invoke("set-photo-save-folder", folderPath),
  selectPhotoSaveFolder: () => ipcRenderer.invoke("select-photo-save-folder"),
  saveImageToFolder: (buffer, fileName, folderPath) =>
    ipcRenderer.invoke("save-image-to-folder", buffer, fileName, folderPath),

  createFolder: (folderPath) => ipcRenderer.invoke("create-folder", folderPath),

  // Logs Save Folder APIs
  getLogsSaveFolder: () => ipcRenderer.invoke("get-logs-save-folder"),
  setLogsSaveFolder: (folderPath) =>
    ipcRenderer.invoke("set-logs-save-folder", folderPath),
  selectLogsSaveFolder: () => ipcRenderer.invoke("select-logs-save-folder"), // Write logs to file
  writeLogsToFile: (content, filename) =>
    ipcRenderer.invoke("write-logs-to-file", content, filename),
  // Read file
  readFile: (relativeFilePath) =>
    ipcRenderer.invoke("read-file", relativeFilePath),

  // Check if file exists
  checkFileExists: (filePath) =>
    ipcRenderer.invoke("check-file-exists", filePath),

  // Local Mode API
  getLocalMode: () => ipcRenderer.invoke("get-local-mode"),
  setLocalMode: (value) => ipcRenderer.invoke("set-local-mode", value),
  // Config API
  getConfig: (key) => ipcRenderer.invoke("get-config", key),
  setConfig: (key, value) => ipcRenderer.invoke("set-config", key, value),

  resetConfig: () => ipcRenderer.invoke("reset-config"),

  // Check RoboGo setup validity
  checkRoboGoSetupValidity: () =>
    ipcRenderer.invoke("check-robogo-setup-validity"),

  // Debug APIs
  getConfigFileLocation: () => ipcRenderer.invoke("get-config-file-location"),
  getFullConfig: () => ipcRenderer.invoke("get-full-config"),

  // Utility APIs
  openRobogoFolder: () => ipcRenderer.invoke("open-robogo-folder"),

  // Image reading APIs
  getImagesFromFolder: (folderPath) =>
    ipcRenderer.invoke("get-images-from-folder", folderPath),
  // Ultrasonic files reading API
  getUltrasonicFiles: (folderPath) =>
    ipcRenderer.invoke("get-ultrasonic-files", folderPath),

  // Read file content API
  readFileContent: (filePath) =>
    ipcRenderer.invoke("read-file-content", filePath),

  // Show file in system explorer
  showItemInFolder: (filePath) =>
    ipcRenderer.invoke("show-item-in-folder", filePath),
});

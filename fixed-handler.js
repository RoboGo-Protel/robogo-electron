// Fixed get-images-from-folder handler
ipcMain.handle("get-images-from-folder", async (event, folderPath) => {
  try {
    console.log("[MAIN] ===============================================");
    console.log("[MAIN] GET IMAGES FROM FOLDER - START");
    console.log("[MAIN] Requested folder path:", folderPath);

    // Get the photo save folder from config
    const photoSaveFolder = getPhotoSaveFolderFromConfig();
    console.log("[MAIN] Photo save folder from config:", photoSaveFolder);

    if (!photoSaveFolder) {
      console.log("[MAIN] ERROR: Photo save folder not configured");
      return { success: false, error: "Photo save folder not configured" };
    }

    // Construct the full path to the folder
    const fullFolderPath = path.join(photoSaveFolder, folderPath);
    console.log("[MAIN] Full folder path:", fullFolderPath);

    // Check if folder exists
    if (!fs.existsSync(fullFolderPath)) {
      console.log("[MAIN] Folder does not exist, creating:", fullFolderPath);
      fs.mkdirSync(fullFolderPath, { recursive: true });
      console.log("[MAIN] Created folder, returning empty array");
      return { success: true, images: [] };
    }

    console.log("[MAIN] Folder exists, reading directory contents...");

    // Read directory contents
    const files = fs.readdirSync(fullFolderPath);
    console.log("[MAIN] Files found in directory:", files);

    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
    const jsonExtensions = [".json"];
    console.log("[MAIN] Looking for image and JSON files...");

    const images = [];
    for (const file of files) {
      const filePath = path.join(fullFolderPath, file);
      const ext = path.extname(file).toLowerCase();

      try {
        const stats = fs.statSync(filePath);
        console.log(
          "[MAIN] Processing:",
          file,
          "isDirectory:",
          stats.isDirectory()
        );

        // Check if it's a directory (date folder like "2025-06-23")
        if (stats.isDirectory()) {
          console.log("[MAIN] Found directory:", file);
          const dirData = {
            fileName: file,
            filePath: filePath,
            dateCreated: stats.mtime.toISOString(),
            size: stats.size,
            isDirectory: true,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(dirData);
        }
        // Check if it's an image file
        else if (imageExtensions.includes(ext)) {
          console.log("[MAIN] Found image file:", file);

          // Try to extract date from filename (format: YYYY-MM-DD_HH-MM-SS.jpg)
          let dateCreated = stats.mtime.toISOString(); // fallback
          const fileNameWithoutExt = path.parse(file).name;
          const dateTimeMatch = fileNameWithoutExt.match(
            /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/
          );

          if (dateTimeMatch) {
            // Convert filename format to ISO string
            const [, datePart, timePart] = dateTimeMatch;
            const timeFormatted = timePart.replace(/-/g, ":");
            const isoString = `${datePart}T${timeFormatted}.000Z`;

            // Validate the parsed date
            const parsedDate = new Date(isoString);
            if (!isNaN(parsedDate.getTime())) {
              dateCreated = isoString;
              console.log(
                "[MAIN] Extracted date from filename:",
                file,
                "->",
                dateCreated
              );
            }
          }

          const imageData = {
            fileName: file,
            filePath: filePath,
            dateCreated: dateCreated,
            size: stats.size,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(imageData);
        }
        // Check if it's a JSON file
        else if (jsonExtensions.includes(ext)) {
          console.log("[MAIN] Found JSON file:", file);
          const jsonData = {
            fileName: file,
            filePath: filePath,
            dateCreated: stats.mtime.toISOString(),
            size: stats.size,
            isJson: true,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(jsonData);
        } else {
          console.log("[MAIN] Skipping unsupported file:", file);
        }
      } catch (statError) {
        console.error("[MAIN] Error getting file stats for:", file, statError);
      }
    }

    // Sort by creation date (newest first)
    images.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

    console.log("[MAIN] Final result:", images.length, "items found");
    console.log("[MAIN] GET IMAGES FROM FOLDER - END");
    console.log("[MAIN] ===============================================");

    return { success: true, images };
  } catch (error) {
    console.error("[MAIN] Error getting files from folder:", error);
    return { success: false, error: error.message };
  }
});

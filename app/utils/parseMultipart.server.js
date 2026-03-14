import Busboy from "busboy";
import { Readable } from "stream";

/**
 * Parse multipart/form-data using busboy.
 * Uses request.arrayBuffer() instead of Readable.fromWeb() for reliability
 * with React Router v7's Node.js adapter.
 */
export async function parseMultipart(request) {
  const contentType = request.headers.get("content-type") || "";

  // Read the full body into a buffer first — more reliable than Readable.fromWeb
  // on React Router v7's Node adapter, especially through the Cloudflare dev tunnel.
  let buffer;
  try {
    buffer = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    throw new Error("Failed to read request body: " + err.message);
  }

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: { "content-type": contentType } });

    const fields = {};
    const files = [];
    const filePromises = [];

    busboy.on("field", (fieldname, value) => {
      if (fieldname in fields) {
        if (!Array.isArray(fields[fieldname])) {
          fields[fieldname] = [fields[fieldname]];
        }
        fields[fieldname].push(value);
      } else {
        fields[fieldname] = value;
      }
    });

    busboy.on("file", (fieldname, fileStream, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      const filePromise = new Promise((res, rej) => {
        fileStream.on("data", (chunk) => chunks.push(chunk));
        fileStream.on("end", () => {
          const data = Buffer.concat(chunks);
          files.push({ fieldname, filename, mimetype: mimeType, size: data.length, data });
          res();
        });
        fileStream.on("error", rej);
      });

      filePromises.push(filePromise);
    });

    busboy.on("finish", async () => {
      try {
        await Promise.all(filePromises);
        resolve({ fields, files });
      } catch (err) {
        reject(err);
      }
    });

    busboy.on("error", (err) => reject(err));

    // Feed the buffer into busboy via a Node.js Readable
    Readable.from(buffer).pipe(busboy);
  });
}

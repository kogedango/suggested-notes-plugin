import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const embeddedGzipPlugin = {
  name: "embedded-gzip",
  setup(build) {
    build.onLoad({ filter: /\.dat\.gz$/ }, (args) => {
      const encoded = fs.readFileSync(args.path).toString("base64");
      const asset = path.basename(args.path);
      return {
        loader: "js",
        resolveDir: process.cwd(),
        contents: `
          import { decodeBase64 } from "./src/analysis/base64";
          let encoded = ${JSON.stringify(encoded)};
          export default function take() {
            if (!encoded) throw new Error(${JSON.stringify(`${asset} was already consumed`)});
            const decoded = decodeBase64(encoded);
            encoded = "";
            return decoded;
          }
        `,
      };
    });
  },
};

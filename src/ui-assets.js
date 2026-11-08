import fs from 'node:fs';
import path from 'node:path';
// A running backend serves one immutable UI revision. Updating source files on
// disk must not expose new frontend imports to an old route/API table.
export function snapshotUi(files,directory,read=fs.readFileSync){
  return new Map(Object.entries(files).map(([route,file])=>[route,Buffer.from(read(path.join(directory,file)))]));
}

import { mkdirSync, copyFileSync } from "node:fs"
import { join } from "node:path"

const src = join("build-v2", "chatbar_media.js")
const dstDir = join("..","st_chatbar_media", "frontend", "build-v2")
const dst = join(dstDir, "chatbar_media.js")

mkdirSync(dstDir, { recursive: true })
copyFileSync(src, dst)
console.log(`Synced ${src} -> ${dst}`)


// CSS is bundled as text inside the JS bundle (--loader:.css=text).
// Copy the source CSS directly so the Python package always has it available.
const src_css = join("src", "chatbar_media.css")
const dst_css = join(dstDir, "chatbar_media.css")

copyFileSync(src_css, dst_css)
console.log(`Synced ${src_css} -> ${dst_css}`)

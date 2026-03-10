import { mkdirSync, copyFileSync } from "node:fs"
import { join } from "node:path"

const src = join("build-v2", "chatbar_media.js")
const dstDir = join("..","st_chatbar_media", "frontend", "build-v2")
const dst = join(dstDir, "chatbar_media.js")

mkdirSync(dstDir, { recursive: true })
copyFileSync(src, dst)
console.log(`Synced ${src} -> ${dst}`)


const src_css = join("build-v2", "chatbar_media.css")
const dstDir_css = join("..","st_chatbar_media", "frontend", "build-v2")
const dst_css = join(dstDir_css, "chatbar_media.css")

mkdirSync(dstDir_css, { recursive: true })
copyFileSync(src_css, dst_css)
console.log(`Synced ${src_css} -> ${dst_css}`)

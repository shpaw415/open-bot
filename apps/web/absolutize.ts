const path = "dist/index.html"
const html = await Bun.file(path).text()
await Bun.write(
  path,
  html.replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/'),
)

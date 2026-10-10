const path = "dist/index.html"
const html = await Bun.file(path).text()
const withIcon = html.includes('rel="icon"')
  ? html
  : html.replace(
      "<head>",
      '<head><link rel="icon" href="/favicon.ico" />',
    )
await Bun.write(
  path,
  withIcon.replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/'),
)

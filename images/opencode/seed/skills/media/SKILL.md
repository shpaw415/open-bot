---
name: media
description: File pictures, 3D models, videos, and other files into the dashboard Media vault. Use ob-media when the user should browse a set of files, or when a file is not embedded in chat.
---

# Media vault

The Media tab in the workspace side menu is a library of albums. Each item is a private copy. Deleting a thread does not delete the album. Deleting an album or item removes the vault copy; the desktop can also delete the source file on disk to free space.

Chat pictures, videos, and `.glb` files are filed into that thread's album on their own. Do not push those again unless the user wants them in a different album.

Use `ob-media` for a named album, or for a file chat does not embed (pdf, audio, stl, zip, txt, md, csv). It talks to the control plane. Do not print the token.

List albums:

```sh
ob-media albums
```

Create or reuse a named album:

```sh
ob-media album "Logos"
```

File an existing file. The album must already exist. `~` is this desktop's home:

```sh
ob-media push --album Logos --path ~/workspace/logo.pdf --title "Cabin logo"
```

Remove a vault copy. Add `--source` to also delete the file on disk (frees desktop space; needs the desktop running, protected paths refused). Without it the file stays on disk: 

```sh
ob-media remove ITEM_ID
ob-media remove ITEM_ID --source
ob-media remove-album ALBUM_ID
ob-media remove-album ALBUM_ID --source
```

Rules:

- The file must already exist under `/home/agent`.
- Do not push `auth.json`, `*-auth.json`, anything under `~/.ssh`, or `~/.config/open-bot`. Those are rejected.
- Tell the user the album name and that it is in Media.
- Still embed chat pictures, videos, and `.glb` files in the reply. The vault is extra, not a replacement.

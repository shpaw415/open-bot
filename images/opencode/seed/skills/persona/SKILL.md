---
name: persona
description: Create, update, or remove a lasting bot personality when the user wants a custom voice or role for future threads. Use ob-persona. Do not use for a one-off tone in the current reply.
---

# Personalities

A personality is a name plus how to behave. The user picks one when starting a thread. It stays for that thread only. Built-ins (Assistant, Designer, Political expert, Software designer) cannot be edited.

Use `ob-persona`. It talks to the control plane. Do not print the token. Do not write a local file, and do not edit `AGENTS.md`, to change your voice.

List:

```sh
ob-persona list
```

Add:

```sh
ob-persona add --name "Brand designer" --instruction "Speak as a brand designer. Prefer concrete visual choices. Keep replies short."
```

Update or remove a custom one (use the id from list):

```sh
ob-persona update ID --instruction "Shorter replies. Always give one option."
ob-persona remove ID
```

Rules:

- Use this when the user wants a lasting voice, not a one-off tone for this reply.
- Creating or editing a personality does not change the current thread.
- Tell the user to start a new thread and pick it.
- The instruction is how to behave, not a secret and not a tool recipe.

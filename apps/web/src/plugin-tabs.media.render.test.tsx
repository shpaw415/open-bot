import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { type PluginTab, PluginTabView } from "./plugin-tabs"

// The frame shim reports getUserMedia on an opaque origin (no dedicated
// pages origin) via postMessage; the Apps tab must explain the fix instead
// of leaving the app silent about the browser's denial.

const appTab: PluginTab = {
  key: "stock:app",
  pluginId: "stock",
  pluginName: "Stock",
  tabId: "app",
  title: "Stock",
  kind: "app",
}

function mount() {
  const realFetch = globalThis.fetch
  const stub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ frameUrl: "/frame/tok/", isolated: false }),
        { status: 200 },
      ),
    )) as unknown as typeof fetch
  globalThis.fetch = stub
  const container = document.createElement("div")
  // Detached on purpose: happy-dom throws when a connected iframe's page
  // load fires, and the app frame always has a src. React attaches its
  // synthetic listeners to the root container, so clicks still work.
  const root: Root = createRoot(container)
  return {
    async open() {
      await act(async () => {
        root.render(<PluginTabView tab={appTab} />)
        await Promise.resolve()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async mediaBlocked() {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "open-bot-frame", type: "media-blocked" },
          }),
        )
        await Promise.resolve()
      })
    },
    async dismiss() {
      const buttons = Array.from(container.querySelectorAll("button"))
      const target = buttons.find(
        (button) => button.getAttribute("aria-label") === "Dismiss",
      )
      if (!target) throw new Error("dismiss button did not render")
      await act(async () => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await Promise.resolve()
      })
    },
    // React does not touch contentWindow, so tests can inject a fake frame
    // window to observe what the shell posts into the sandboxed frame.
    stubFrameWindow(fake: { postMessage: (msg: unknown) => void }) {
      const iframe = container.querySelector("iframe")
      if (!iframe) throw new Error("app frame did not render")
      Object.defineProperty(iframe, "contentWindow", {
        value: fake,
        configurable: true,
      })
    },
    async requestMedia(req: { id: string; audio: boolean; video: boolean }) {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "open-bot-frame", type: "media-request", ...req },
          }),
        )
        await Promise.resolve()
      })
    },
    async send(data: Record<string, unknown>) {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "open-bot-frame", ...data },
          }),
        )
        await Promise.resolve()
      })
    },
    async answer(label: string) {
      const buttons = Array.from(container.querySelectorAll("button"))
      const target = buttons.find(
        (button) => button.getAttribute("aria-label") === label,
      )
      if (!target) throw new Error(`${label} button did not render`)
      await act(async () => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await Promise.resolve()
      })
    },
    html: () => container.innerHTML,
    close() {
      act(() => root.unmount())
      container.remove()
      globalThis.fetch = realFetch
    },
  }
}

// happy-dom exposes navigator members as readonly getters; shadow with an
// own property and restore (or drop the shadow) afterwards.
function patchNavigator(key: string, value: unknown): () => void {
  const nav = navigator as unknown as Record<string, unknown>
  const owned = Object.hasOwn(nav, key)
  const real = nav[key]
  Object.defineProperty(nav, key, { value, configurable: true })
  return () => {
    if (owned) {
      Object.defineProperty(nav, key, { value: real, configurable: true })
    } else {
      delete (nav as { [k: string]: unknown })[key]
    }
  }
}

describe("AppTab — media-blocked banner", () => {
  test("frame renders with delegated device permissions", async () => {
    const view = mount()
    await view.open()
    const iframe = view.html().match(/<iframe[^>]*>/)?.[0]
    expect(iframe).toBeTruthy()
    expect(iframe).toContain("sandbox=")
    expect(iframe).toContain("microphone 'src'")
    expect(iframe).toContain("camera 'src'")
    view.close()
  })

  test("shim report shows the failure banner; dismiss clears it", async () => {
    const view = mount()
    await view.open()
    expect(view.html()).not.toContain("could not reach your devices")
    await view.mediaBlocked()
    expect(view.html()).toContain("could not reach your devices")
    await view.dismiss()
    expect(view.html()).not.toContain("could not reach your devices")
    view.close()
  })

  test("unrelated messages never raise the banner", async () => {
    const view = mount()
    await view.open()
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { source: "open-bot-frame" } }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "other", type: "media-blocked" },
        }),
      )
      await Promise.resolve()
    })
    expect(view.html()).not.toContain("could not reach your devices")
    view.close()
  })

  test("blocked report carries the bridge's reason (stale-shell case)", async () => {
    const view = mount()
    await view.open()
    await view.send({
      type: "media-blocked",
      error:
        "media bridge unavailable — the dashboard tab may be stale; refresh the dashboard page",
    })
    expect(view.html()).toContain("could not reach your devices")
    expect(view.html()).toContain("refresh the dashboard page")
    view.close()
  })

  test("insecure shell denies the capture instead of throwing", async () => {
    const restore = patchNavigator("mediaDevices", undefined)
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.requestMedia({ id: "m9", audio: true, video: false })
      expect(view.html()).toContain("This app wants access")
      await view.answer("Allow device")
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        source: "open-bot-shell",
        type: "media-denied",
        id: "m9",
      })
      expect(String((sent[0] as { error?: string }).error)).toContain("https")
      view.close()
    } finally {
      restore()
    }
  })

  test("media-request shows a consent bar; deny answers the frame", async () => {
    const view = mount()
    await view.open()
    const sent: unknown[] = []
    view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
    await view.requestMedia({ id: "m1", audio: true, video: false })
    expect(view.html()).toContain("This app wants access to your microphone")
    await view.answer("Deny device")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      source: "open-bot-shell",
      type: "media-denied",
      id: "m1",
    })
    expect(view.html()).not.toContain("This app wants access")
    view.close()
  })

  test("allow captures and offers SDP; release stops the capture", async () => {
    const stopped: boolean[] = []
    const stream = {
      getTracks: () => [
        {
          stop: () => stopped.push(true),
          addEventListener: () => {},
        },
      ],
    }
    const remoteDescriptions: unknown[] = []
    class FakePC {
      static last: FakePC | null = null
      localDescription = { type: "offer", sdp: "offer-sdp" }
      iceGatheringState = "complete"
      connectionState = "new"
      onconnectionstatechange: (() => void) | null = null
      ontrack: (() => void) | null = null
      createOffer = () => Promise.resolve({ type: "offer", sdp: "offer-sdp" })
      setLocalDescription = () => Promise.resolve()
      setRemoteDescription = (desc: unknown) => {
        remoteDescriptions.push(desc)
        return Promise.resolve()
      }
      addEventListener = () => {}
      removeEventListener = () => {}
      addTrack = () => {}
      close = () => {}
    }
    const navigatorAny = navigator as unknown as Record<string, unknown>
    const realDevices = navigatorAny.mediaDevices
    const realPC = (globalThis as Record<string, unknown>).RTCPeerConnection
    navigatorAny.mediaDevices = {
      getUserMedia: () => Promise.resolve(stream),
    }
    ;(globalThis as Record<string, unknown>).RTCPeerConnection = FakePC
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.requestMedia({ id: "m2", audio: true, video: true })
      expect(view.html()).toContain("microphone and camera")
      await view.answer("Allow device")
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        source: "open-bot-shell",
        type: "media-offer",
        id: "m2",
        sdp: "offer-sdp",
      })
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "open-bot-frame",
              type: "media-answer",
              id: "m2",
              sdp: "answer-sdp",
            },
          }),
        )
        await Promise.resolve()
      })
      expect(remoteDescriptions).toEqual([
        { type: "answer", sdp: "answer-sdp" },
      ])
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              source: "open-bot-frame",
              type: "media-release",
              id: "m2",
            },
          }),
        )
        await Promise.resolve()
      })
      expect(stopped).toEqual([true])
      view.close()
    } finally {
      navigatorAny.mediaDevices = realDevices
      ;(globalThis as Record<string, unknown>).RTCPeerConnection = realPC
    }
  })

  test("screen share rides the same bridge via getDisplayMedia", async () => {
    const stream = { getTracks: () => [] }
    const navigatorAny = navigator as unknown as Record<string, unknown>
    const realDisplay = navigatorAny.getDisplayMedia
    const realDevices = navigatorAny.mediaDevices
    const realPC = (globalThis as Record<string, unknown>).RTCPeerConnection
    navigatorAny.getDisplayMedia = () => Promise.resolve(stream)
    navigatorAny.mediaDevices = {
      getUserMedia: () => Promise.reject(new Error("must not be used")),
    }
    ;(globalThis as Record<string, unknown>).RTCPeerConnection = class {
      localDescription = { type: "offer", sdp: "screen-sdp" }
      iceGatheringState = "complete"
      connectionState = "new"
      onconnectionstatechange: (() => void) | null = null
      createOffer = () => Promise.resolve({ type: "offer", sdp: "screen-sdp" })
      setLocalDescription = () => Promise.resolve()
      setRemoteDescription = () => Promise.resolve()
      addEventListener = () => {}
      removeEventListener = () => {}
      addTrack = () => {}
      close = () => {}
    }
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.send({
        type: "media-request",
        id: "s1",
        display: true,
        audio: false,
        video: false,
      })
      expect(view.html()).toContain("your screen")
      await view.answer("Allow device")
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        source: "open-bot-shell",
        type: "media-offer",
        id: "s1",
        sdp: "screen-sdp",
      })
      view.close()
    } finally {
      navigatorAny.getDisplayMedia = realDisplay
      navigatorAny.mediaDevices = realDevices
      ;(globalThis as Record<string, unknown>).RTCPeerConnection = realPC
    }
  })

  test("geolocation current: consent, then the fix is relayed; deny errors", async () => {
    const fakePos = {
      coords: {
        latitude: 45.5,
        longitude: -73.6,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 1234,
    }
    const restoreGeo = patchNavigator("geolocation", {
      getCurrentPosition: (ok: (p: unknown) => void) => ok(fakePos),
      watchPosition: () => 7,
      clearWatch: () => {},
    })
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.send({
        type: "geo-request",
        id: "g1",
        kind: "current",
        opts: {},
      })
      expect(view.html()).toContain("This app wants access to your location")
      await view.answer("Allow device")
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        source: "open-bot-shell",
        type: "geo-response",
        id: "g1",
        pos: { coords: { latitude: 45.5, longitude: -73.6 }, timestamp: 1234 },
      })
      view.close()
    } finally {
      restoreGeo()
    }
  })

  test("geolocation watch starts on allow and geo-clear stops it", async () => {
    const cleared: number[] = []
    const restoreGeo = patchNavigator("geolocation", {
      getCurrentPosition: () => {},
      watchPosition: () => 42,
      clearWatch: (id: number) => cleared.push(id),
    })
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.send({
        type: "geo-request",
        id: "g2",
        kind: "watch",
        opts: {},
      })
      await view.answer("Allow device")
      expect(sent).toHaveLength(0)
      await view.send({ type: "geo-clear", id: "g2" })
      expect(cleared).toEqual([42])
      view.close()
    } finally {
      restoreGeo()
    }
  })

  test("clipboard writes bridge without a prompt", async () => {
    const written: string[] = []
    const restoreClipboard = patchNavigator("clipboard", {
      writeText: (text: string) => {
        written.push(text)
        return Promise.resolve()
      },
    })
    try {
      const view = mount()
      await view.open()
      const sent: unknown[] = []
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.send({ type: "clip-write", id: "c1", text: "hello" })
      expect(written).toEqual(["hello"])
      expect(sent).toEqual([
        { source: "open-bot-shell", type: "clip-result", id: "c1" },
      ])
      view.close()
    } finally {
      restoreClipboard()
    }
  })

  test("MIDI: consent, port snapshot, listen relay and send", async () => {
    const sent: unknown[] = []
    const handlers: unknown[] = []
    const input = {
      id: "in1",
      name: "Keys",
      manufacturer: "Yamaha",
      state: "connected",
      connection: "closed",
      type: "input",
      version: "1.0",
      onmidimessage: null as ((event: unknown) => void) | null,
    }
    const output = {
      id: "out1",
      name: "Synth",
      manufacturer: "Korg",
      state: "connected",
      connection: "closed",
      type: "output",
      version: "1.0",
      send: (data: Uint8Array) => {
        handlers.push(Array.from(data))
      },
    }
    const access = {
      inputs: new Map([["in1", input]]),
      outputs: new Map([["out1", output]]),
      sysexEnabled: false,
      onstatechange: null as ((event: unknown) => void) | null,
    }
    const restoreMidi = patchNavigator("requestMIDIAccess", () =>
      Promise.resolve(access),
    )
    try {
      const view = mount()
      await view.open()
      view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
      await view.send({ type: "midi-request", id: "md1", sysex: false })
      expect(view.html()).toContain(
        "This app wants access to your MIDI devices",
      )
      await view.answer("Allow device")
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        source: "open-bot-shell",
        type: "midi-access",
        id: "md1",
        sysexEnabled: false,
        inputs: [
          { id: "in1", name: "Keys", type: "input", connection: "closed" },
        ],
        outputs: [{ id: "out1", name: "Synth", type: "output" }],
      })
      await view.send({ type: "midi-listen", id: "md1", portId: "in1" })
      expect(typeof input.onmidimessage).toBe("function")
      input.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) })
      expect(sent).toHaveLength(2)
      expect(sent[1]).toMatchObject({
        source: "open-bot-shell",
        type: "midi-message",
        id: "md1",
        portId: "in1",
        data: [0x90, 60, 100],
      })
      await view.send({
        type: "midi-send",
        id: "md1",
        portId: "out1",
        data: [0x80, 60, 0],
        timestamp: 42,
      })
      expect(handlers).toEqual([[0x80, 60, 0]])
      await view.send({ type: "midi-unlisten", id: "md1", portId: "in1" })
      expect(input.onmidimessage).toBeNull()
      view.close()
    } finally {
      restoreMidi()
    }
  })

  test("MIDI denial rejects the frame request", async () => {
    const view = mount()
    await view.open()
    const sent: unknown[] = []
    view.stubFrameWindow({ postMessage: (msg: unknown) => sent.push(msg) })
    await view.send({ type: "midi-request", id: "md2", sysex: true })
    expect(view.html()).toContain("(SysEx)")
    await view.answer("Deny device")
    expect(sent).toEqual([
      {
        source: "open-bot-shell",
        type: "midi-denied",
        id: "md2",
        error: "user denied",
      },
    ])
    view.close()
  })
})

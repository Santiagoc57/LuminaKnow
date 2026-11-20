// LUMINA como app de macOS: ventana propia con icono en el Dock.
// En este Mac arranca el servidor si no está corriendo; en otro Mac se conecta a la dirección que le indiques.
import Cocoa
import WebKit

let defaults = UserDefaults.standard
let bundledRoot = Bundle.main.object(forInfoDictionaryKey: "LuminaRoot") as? String ?? ""

func serverURL() -> URL {
  if let saved = defaults.string(forKey: "serverURL"), let url = URL(string: saved) { return url }
  return URL(string: "http://localhost:3000/")!
}

func isLocal(_ url: URL) -> Bool { ["localhost", "127.0.0.1"].contains(url.host ?? "") }

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!
  let status = NSTextField(labelWithString: "Abriendo tu biblioteca…")

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.isHidden = true

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "LUMINA"
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    // La barra de título del color de LUMINA: los botones de la ventana quedan encima del contenido, sin tocarlo.
    window.backgroundColor = NSColor(calibratedRed: 0.965, green: 0.957, blue: 0.94, alpha: 1)
    window.setFrameAutosaveName("LUMINA")
    if !window.setFrameUsingName("LUMINA") { window.center() }
    let container = NSView()
    container.wantsLayer = true
    container.layer?.backgroundColor = NSColor(calibratedRed: 0.97, green: 0.965, blue: 0.945, alpha: 1).cgColor
    status.alignment = .center
    status.textColor = .secondaryLabelColor
    status.font = .systemFont(ofSize: 15)
    for view in [web!, status] as [NSView] { view.translatesAutoresizingMaskIntoConstraints = false; container.addSubview(view) }
    NSLayoutConstraint.activate([
      web.leadingAnchor.constraint(equalTo: container.leadingAnchor), web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      web.topAnchor.constraint(equalTo: container.topAnchor), web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      status.centerXAnchor.constraint(equalTo: container.centerXAnchor), status.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      status.widthAnchor.constraint(lessThanOrEqualToConstant: 520),
    ])
    window.contentView = container
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    start()
  }

  // En este Mac: asegura que el servidor esté corriendo (y al día). En otro Mac: pregunta la dirección la primera vez.
  func start() {
    let url = serverURL()
    let hasServerHere = !bundledRoot.isEmpty && FileManager.default.fileExists(atPath: bundledRoot + "/scripts/app/ensure-server.sh")
    if isLocal(url) && !hasServerHere && defaults.string(forKey: "serverURL") == nil { askForAddress(); return }
    if isLocal(url) && hasServerHere {
      status.stringValue = "Abriendo tu biblioteca…"
      DispatchQueue.global().async {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = [bundledRoot + "/scripts/app/ensure-server.sh"]
        try? task.run()
        task.waitUntilExit()
        DispatchQueue.main.async { self.load(url) }
      }
    } else {
      load(url)
    }
  }

  func load(_ url: URL) {
    web.load(URLRequest(url: url))
  }

  func askForAddress() {
    let alert = NSAlert()
    alert.messageText = "¿Dónde está tu LUMINA?"
    alert.informativeText = "Escribe la dirección del Mac donde corre LUMINA (la ves en Ajustes → LUMINA como app). Por ejemplo: 192.168.1.130:3000"
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
    field.placeholderString = "192.168.1.130:3000"
    field.stringValue = defaults.string(forKey: "serverURL") ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "Conectar")
    alert.addButton(withTitle: "Salir")
    guard alert.runModal() == .alertFirstButtonReturn else { NSApp.terminate(nil); return }
    var value = field.stringValue.trimmingCharacters(in: .whitespaces)
    if !value.hasPrefix("http") { value = "http://" + value }
    if !value.hasSuffix("/") { value += "/" }
    guard let url = URL(string: value), url.host != nil else { askForAddress(); return }
    defaults.set(url.absoluteString, forKey: "serverURL")
    status.stringValue = "Conectando con \(url.host ?? "")…"
    load(url)
  }

  @objc func changeAddress() { askForAddress() }
  @objc func reloadPage() { web.reload() }
  @objc func goBack() { web.goBack() }
  @objc func goHome() { load(serverURL()) }

  // ---- Navegación ----
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { web.isHidden = false; status.isHidden = true }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    web.isHidden = true
    status.isHidden = false
    status.stringValue = "No pude abrir LUMINA en \(serverURL().host ?? ""). ¿Está encendido ese Mac?\nReintentando…"
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.load(serverURL()) }
  }

  // Los enlaces a otros sitios (YouTube, X, artículos…) se abren en tu navegador, no dentro de LUMINA.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { decisionHandler(.download); return }
    if let url = action.request.url, let host = url.host, host != serverURL().host, action.navigationType == .linkActivated || action.targetFrame == nil {
      NSWorkspace.shared.open(url); decisionHandler(.cancel); return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  // target="_blank": dentro de LUMINA se abre aquí; fuera, en el navegador.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url {
      if url.host == serverURL().host { web.load(action.request) } else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  // Elegir archivos (subir imágenes, PDF…).
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
  }

  // Micrófono para dictar: solo para tu LUMINA.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == serverURL().host ? .grant : .deny)
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Aceptar"); alert.addButton(withTitle: "Cancelar")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let alert = NSAlert(); alert.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24)); field.stringValue = defaultText ?? ""
    alert.accessoryView = field; alert.addButton(withTitle: "Aceptar"); alert.addButton(withTitle: "Cancelar")
    completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
  }

  // Descargas (PDF, imágenes) a la carpeta Descargas.
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var target = folder.appendingPathComponent(suggestedFilename)
    var index = 1
    while FileManager.default.fileExists(atPath: target.path) {
      let base = (suggestedFilename as NSString).deletingPathExtension, ext = (suggestedFilename as NSString).pathExtension
      target = folder.appendingPathComponent("\(base) \(index)\(ext.isEmpty ? "" : ".\(ext)")"); index += 1
    }
    completionHandler(target)
  }
  func downloadDidFinish(_ download: WKDownload) { NSSound(named: "Glass")?.play() }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  // Menú con Editar (para copiar y pegar), Ver y la dirección del servidor.
  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Acerca de LUMINA", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Cambiar dirección del servidor…", action: #selector(changeAddress), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Ocultar LUMINA", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Salir de LUMINA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Editar")
    edit.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem(); main.addItem(viewItem)
    let view = NSMenu(title: "Ver")
    view.addItem(withTitle: "Inicio", action: #selector(goHome), keyEquivalent: "0")
    view.addItem(withTitle: "Atrás", action: #selector(goBack), keyEquivalent: "[")
    view.addItem(withTitle: "Recargar", action: #selector(reloadPage), keyEquivalent: "r")
    view.addItem(.separator())
    view.addItem(withTitle: "Pantalla completa", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
    viewItem.submenu = view

    let windowItem = NSMenuItem(); main.addItem(windowItem)
    let windowMenu = NSMenu(title: "Ventana")
    windowMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "Cerrar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowItem.submenu = windowMenu
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

import ExpoModulesCore
import UIKit

private let hardwareSubmitEventName = "onHardwareKeyboardSubmit"
private let hardwareQueueEventName = "onHardwareKeyboardQueue"

private weak var activeModule: PaseoHardwareKeyboardModule?
private var isHardwareSubmitEnabled = false

@objc
public class PaseoHardwareKeyboardReactDelegateHandler: ExpoReactDelegateHandler {
  public override func createRootViewController() -> UIViewController? {
    return PaseoHardwareKeyboardRootViewController()
  }
}

public class PaseoHardwareKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaseoHardwareKeyboard")

    Events(hardwareSubmitEventName, hardwareQueueEventName)

    OnCreate {
      activeModule = self
    }

    Function("setHardwareKeyboardSubmitEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        isHardwareSubmitEnabled = enabled
      }
    }

    OnDestroy {
      if activeModule === self {
        activeModule = nil
      }
      isHardwareSubmitEnabled = false
    }
  }

  fileprivate func emitHardwareKeyboardSubmit() {
    sendEvent(hardwareSubmitEventName, [:])
  }

  fileprivate func emitHardwareKeyboardQueue() {
    sendEvent(hardwareQueueEventName, [:])
  }
}

private final class PaseoHardwareKeyboardRootViewController: UIViewController {
  override var keyCommands: [UIKeyCommand]? {
    guard isHardwareSubmitEnabled && UIDevice.current.userInterfaceIdiom == .pad else {
      return super.keyCommands
    }

    let commands = [
      UIKeyCommand(
        input: "\r",
        modifierFlags: .command,
        action: #selector(handleHardwareKeyboardSubmit(_:))
      ),
      UIKeyCommand(
        input: "\r",
        modifierFlags: .control,
        action: #selector(handleHardwareKeyboardSubmit(_:))
      ),
      UIKeyCommand(
        input: "\t",
        modifierFlags: [],
        action: #selector(handleHardwareKeyboardQueue(_:))
      ),
    ]
    if #available(iOS 15.0, *) {
      for command in commands {
        command.wantsPriorityOverSystemBehavior = true
      }
    }
    return (super.keyCommands ?? []) + commands
  }

  @objc
  private func handleHardwareKeyboardSubmit(_ sender: UIKeyCommand) {
    guard canSubmitCurrentTextInput() else {
      return
    }
    activeModule?.emitHardwareKeyboardSubmit()
  }

  @objc
  private func handleHardwareKeyboardQueue(_ sender: UIKeyCommand) {
    guard canSubmitCurrentTextInput() else {
      return
    }
    activeModule?.emitHardwareKeyboardQueue()
  }

  private func canSubmitCurrentTextInput() -> Bool {
    guard let responder = UIResponder.paseoCurrentFirstResponder else {
      return false
    }
    guard let textInput = responder as? UITextInput else {
      return false
    }
    return textInput.markedTextRange == nil
  }
}

private extension UIResponder {
  private static weak var currentFirstResponder: UIResponder?

  static var paseoCurrentFirstResponder: UIResponder? {
    currentFirstResponder = nil
    UIApplication.shared.sendAction(
      #selector(captureCurrentFirstResponder(_:)),
      to: nil,
      from: nil,
      for: nil
    )
    return currentFirstResponder
  }

  @objc
  private func captureCurrentFirstResponder(_ sender: Any?) {
    UIResponder.currentFirstResponder = self
  }
}

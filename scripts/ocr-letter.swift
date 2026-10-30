import Foundation
import AppKit
import Vision
import PDFKit

func recognize(_ image: NSImage) throws -> (String, Double) {
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw NSError(domain: "OCR", code: 1) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted { a,b in
        if abs(a.boundingBox.midY-b.boundingBox.midY) < 0.008 { return a.boundingBox.minX < b.boundingBox.minX }
        return a.boundingBox.midY > b.boundingBox.midY
    }
    let candidates = observations.compactMap { $0.topCandidates(1).first }
    return (candidates.map { $0.string }.joined(separator: "\n"), candidates.isEmpty ? 0 : candidates.reduce(0.0) { $0 + Double($1.confidence) } / Double(candidates.count))
}
do {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    var texts: [String] = [], scores: [Double] = []
    if url.pathExtension.lowercased() == "pdf" {
        guard let document = PDFDocument(url: url), document.pageCount <= 200 else { throw NSError(domain: "PDF", code: 2) }
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { continue }
            let rect = page.bounds(for: .mediaBox)
            let image = page.thumbnail(of: NSSize(width: rect.width*2.2, height: rect.height*2.2), for: .mediaBox)
            let (text, confidence) = try recognize(image)
            texts.append("【第\(i+1)页】\n" + text); scores.append(confidence)
        }
    } else {
        guard let image = NSImage(contentsOf: url) else { throw NSError(domain: "Image", code: 3) }
        let (text, confidence) = try recognize(image); texts.append(text); scores.append(confidence)
    }
    let data = try JSONSerialization.data(withJSONObject: ["text": texts.joined(separator: "\n\n"), "confidence": scores, "method": "macOS Vision OCR"])
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("本机OCR失败：\(error.localizedDescription)".utf8)); exit(1)
}

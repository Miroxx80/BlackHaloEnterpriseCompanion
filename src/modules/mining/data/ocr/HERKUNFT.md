# Texterkennungs-Modell (PaddleOCR)

| Datei | Herkunft | SHA-256 |
|---|---|---|
| `ppocr-v4-rec.onnx` | npm `paddle-ocr-onnx-models@0.2.0`, Datei `models/ch_PP-OCRv4_rec_infer.onnx` (ONNX-Umwandlung des PaddleOCR-Modells PP-OCRv4 rec, Apache-2.0) | `48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b` |
| `ppocr-v4-det.onnx` | npm `paddle-ocr-onnx-models@0.2.0`, Datei `models/ch_PP-OCRv4_det_infer.onnx` (ONNX-Umwandlung des PaddleOCR-Modells PP-OCRv4 det, Apache-2.0; Weiterverteilung von huggingface.co/SWHL/RapidOCR) | `d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9` |
| `ppocr_keys_v1.txt` | PaddleOCR, Zweig `release/2.7`, `ppocr/utils/ppocr_keys_v1.txt` (Apache-2.0) | `28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7` |
| `LICENSE-Apache-2.0.txt` | Lizenztext aus dem npm-Paket | |

Zwei Modelle: Die Detektion findet Textzeilen im Suchbereich (damit das Scan-Panel auch gefunden wird, wenn es
verschoben ist; im PC-Test vom 2026-11-26 bis ~100 px), die Zeilenerkennung liest sie. Auswahl und Messung:
Spike vom 2026-11-26 (86 % auf verlustbehafteten Screenshots, Erznamen 10/10).

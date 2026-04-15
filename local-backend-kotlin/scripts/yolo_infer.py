#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO inference on a single image.")
    parser.add_argument("--model", required=True, help="Path to the YOLO .pt model")
    parser.add_argument("--image", required=True, help="Path to the input image")
    parser.add_argument("--output-image", required=True, help="Where to save the annotated image")
    parser.add_argument("--output-json", required=True, help="Where to save the JSON metadata")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--iou", type=float, default=0.45, help="IoU threshold")
    parser.add_argument("--imgsz", type=int, default=1280, help="Inference image size")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    model_path = Path(args.model).expanduser().resolve()
    image_path = Path(args.image).expanduser().resolve()
    output_image = Path(args.output_image).expanduser().resolve()
    output_json = Path(args.output_json).expanduser().resolve()

    if not model_path.exists():
        raise FileNotFoundError(f"YOLO model not found: {model_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"Input image not found: {image_path}")

    output_image.parent.mkdir(parents=True, exist_ok=True)
    output_json.parent.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(model_path))
    results = model.predict(
        source=str(image_path),
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        verbose=False,
        save=False,
    )
    result = results[0]

    annotated = result.plot(pil=True)
    annotated.save(output_image, format="JPEG", quality=92)

    detections = []
    boxes = result.boxes
    names = result.names or {}
    if boxes is not None:
        for box in boxes:
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].tolist()
            detections.append(
                {
                    "classId": cls_id,
                    "className": str(names.get(cls_id, cls_id)),
                    "confidence": round(conf, 6),
                    "box": {
                        "x1": round(float(xyxy[0]), 2),
                        "y1": round(float(xyxy[1]), 2),
                        "x2": round(float(xyxy[2]), 2),
                        "y2": round(float(xyxy[3]), 2),
                    },
                }
            )

    payload = {
        "model": model_path.name,
        "image": {
            "width": int(result.orig_shape[1]),
            "height": int(result.orig_shape[0]),
        },
        "detections": detections,
        "count": len(detections),
    }

    output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        raise

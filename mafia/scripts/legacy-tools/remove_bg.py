import sys
import glob
import os

try:
    from PIL import Image
except ImportError:
    print("Pillow not installed")
    sys.exit(1)

def process(path):
    print(f"Processing {path}...")
    try:
        img = Image.open(path).convert('RGBA')
        pixels = img.load()
        width, height = img.size
        
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                
                # If the user already made some parts transparent, 
                # we should respect the original alpha if it's 0.
                if a == 0:
                    continue
                
                v = max(r, g, b)
                
                if v <= 165:
                    pixels[x, y] = (255, 255, 255, 0)
                else:
                    new_alpha = min(255, int(((v - 165) / (255 - 165)) * 255))
                    # Multiply by original alpha proportionally if already partially transparent
                    new_alpha = int(new_alpha * (a / 255.0))
                    pixels[x, y] = (255, 255, 255, new_alpha)
                    
        img.save(path, 'PNG')
    except Exception as e:
        print(f"Failed {path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python remove_bg.py <path_pattern>")
        sys.exit(1)
        
    for arg in sys.argv[1:]:
        matches = glob.glob(arg)
        if not matches:
            print(f"No files found for {arg}")
        for f in matches:
            process(f)

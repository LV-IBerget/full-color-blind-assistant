using System;
using UnityEngine;
using UnityEngine.UI;

public class ColorNameFinder : MonoBehaviour
{

    public Image debugColor;
    private int frameCounter = 0;

    private bool calibrateWhiteBalance = false;

    // Define a struct to hold color names and their corresponding Color values
    private struct NamedColor
    {

        public string name;
        public Color color;

        public NamedColor(string name, Color color )
        {
            this.name = name;
            this.color = color;
        }
    }
    public RawImage rawImage;

    public TMPro.TMP_Text txt;

    // Array of named colors
    private static NamedColor[] namedColors = {
        // Primary colors
        new NamedColor("Red", Color.red),
        new NamedColor("Yellow", new Color(1f, 0.65f, 0.0f)), // Red + Yellow),
        new NamedColor("Blue", Color.blue),

        // Secondary colors
        new NamedColor("Orange", new Color(1.0f, 0.5f, 0.0f)), // Red + Yellow
        new NamedColor("Green", Color.green),                  // Yellow + Blue
        new NamedColor("Purple", new Color(1f, 0.0f, 1f)), // Red + Blue

                // Tertiary colors
        new NamedColor("Red-Orange", new Color(1.0f, 0.25f, 0.0f)), // Red + Orange
        new NamedColor("Yellow-Orange", new Color(1.0f, 0.5f, 0.0f)),    // Yellow + Orange
        new NamedColor("Yellow-Green", new Color(0.5f, 1.0f, 0.0f)),// Yellow + Green
        new NamedColor("Blue-Green", new Color(0.0f, 0.75f, 1.0f)),      // Blue + Green
        new NamedColor("Blue-Violet", new Color(0.75f, 0.0f, 1.0f)),    // Blue + Purple
        new NamedColor("Red-Violet", new Color(1.0f, 0.0f, 0.5f))    // Red + Purple
    };

    public Texture2D tex = null;

    // Method to get the name of the closest color
    public string LookupColorName(Color color)
    {
        Color saturatedColor = SaturateColor(color);

        NamedColor closestColor = namedColors[0];
        float closestDistance = float.MaxValue;

        XYZColor xyz = XYZColor.FromColor(saturatedColor);
        CIELabColor lab = CIELabColor.FromXYZ(xyz);

        foreach (var namedColor in namedColors)
        {
            XYZColor targetXyz = XYZColor.FromColor(namedColor.color);
            CIELabColor targetLab = CIELabColor.FromXYZ(targetXyz);

            float distance = lab.DistanceTo(targetLab);

            if (distance < closestDistance)
            {
                closestColor = namedColor;
                closestDistance = distance;
            }
        }
        if(debugColor)
            debugColor.color = saturatedColor;
        return closestColor.name;
    }


    //Slowed to a very low rate in project settings.
    void FixedUpdate()
    {
        frameCounter++;
        if (frameCounter % 3 != 0)
            return;

        Color averageColor = GetAverageColor();
        Color.RGBToHSV(averageColor, out float hue, out float saturation, out float value);


        if (saturation < 0.2f)
            txt.text = LookupGrayscaleName(value);
        else
            txt.text = LookupColorName(averageColor);
    }

    private string LookupGrayscaleName(float value)
    {
        if (value <= 0.2f)
        {
            return "Black";
        }
        else if (value <= 0.4f)
        {
            return "Dark Gray";
        }
        else if (value <= 0.6f)
        {
            return "Medium Gray";
        }
        else if (value <= 0.8f)
        {
            return "Light Gray";
        }
        else
        {
            return "White";
        }
    }

    Texture2D ConvertRenderTextureToTexture2D(RenderTexture rt, ref Texture2D texture2D)
    {
        // Set the active RenderTexture
        RenderTexture.active = rt;

        // Create a new Texture2D with the same dimensions as the RenderTexture
        if (!texture2D)
            texture2D = new Texture2D(1, 1, TextureFormat.RGBA32, false);

        // Read the pixels from the RenderTexture into the Texture2D
        texture2D.ReadPixels(new Rect((rt.width / 2) - 0, (rt.height / 2) - 0, 1, 1), 0, 0);
        texture2D.Apply();

        // Reset the active RenderTexture
        RenderTexture.active = null;

        return texture2D;
    }

    Color GetAverageColor()
    {
        if (!rawImage.texture)
            return Color.white;
        Texture2D texture = ConvertRenderTextureToTexture2D(rawImage.texture as RenderTexture, ref tex);
        if (texture == null)
        {
            Debug.LogError("Cannot read texture");
            return Color.black;
        }

        Color[] pixels = texture.GetPixels(0, 0, 1, 1);
        Color sumColor = new Color(0, 0, 0, 0);

        foreach (Color pixel in pixels)
        {
            sumColor += pixel;
        }

        return sumColor / pixels.Length;
    }

    public static Color SaturateColor(Color color)
    {
        // Convert the color from RGB to HSV
        Color.RGBToHSV(color, out float h, out float s, out float v);

        // Adjust the saturation
        s = 1f;

        // Convert the color back to RGB
        return Color.HSVToRGB(h, s, v);
    }
}



public class CIELabColor
{
    public float l;
    public float a;
    public float b;

    public static CIELabColor FromXYZ(XYZColor color)
    {
        CIELabColor result = new CIELabColor();

        float x = color.x / 95.047f;
        float y = color.y / 100f;
        float z = color.z / 108.883f;

        if (x > 0.008856f)
        {
            x = Mathf.Pow(x, 1f / 3f);
        }
        else
        {
            x = (7.787f * x) + (16f / 116f);
        }

        if (y > 0.008856f)
        {
            y = Mathf.Pow(y, 1f / 3f);
        }
        else
        {
            y = (7.787f * y) + (16f / 116f);
        }

        if (z > 0.008856f)
        {
            z = Mathf.Pow(z, 1f / 3f);
        }
        else
        {
            z = (7.787f * z) + (16f / 116f);
        }

        result.l = (116f * y) - 16f;
        result.a = 500f * (x - y);
        result.b = 200f * (y - z);

        return result;
    }

    public float DistanceTo(CIELabColor color)
    {
        float deltaL = Mathf.Pow(color.l - l, 2f);
        float deltaA = Mathf.Pow(color.a - a, 2f);
        float deltaB = Mathf.Pow(color.b - b, 2f);
        float delta = Mathf.Sqrt(deltaL + deltaA + deltaB);

        return delta;
    }
}


public class XYZColor
{
    public float x;
    public float y;
    public float z;

    public static XYZColor FromColor(Color color)
    {
        XYZColor result = new XYZColor();

        float r = color.r;// / 255f;
        float g = color.g;// / 255f;
        float b = color.b;// / 255f;

        if (r > 0.04045f)
        {
            r = Mathf.Pow((r + 0.055f) / 1.055f, 2.4f);
        }
        else
        {
            r = r / 12.92f;
        }

        if (g > 0.04045f)
        {
            g = Mathf.Pow((g + 0.055f) / 1.055f, 2.4f);
        }
        else
        {
            g = g / 12.92f;
        }

        if (b > 0.04045f)
        {
            b = Mathf.Pow((b + 0.055f) / 1.055f, 2.4f);
        }
        else
        {
            b = b / 12.92f;
        }

        r *= 100f;
        g *= 100f;
        b *= 100f;

        result.x = r * 0.4124f + g * 0.3576f + b * 0.1805f;
        result.y = r * 0.2126f + g * 0.7152f + b * 0.0722f;
        result.z = r * 0.0193f + g * 0.1192f + b * 0.9505f;

        return result;
    }
}
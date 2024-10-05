using TMPro;
using UnityEngine;
using UnityEngine.UI;
using System.Collections;
using System;

public class WebcamDropdown : MonoBehaviour
{
    public TMP_Dropdown dropdown;
    public RawImage display;
    public RenderTexture renderTexture;
    private WebCamTexture webcamTexture;
    private WebCamTexture tex { get { return webcamTexture; } }
    private WebCamDevice[] devices;

    public float aspectRatio = 1.0f;
    public AspectRatioFitter aspectRatioFitter;

    void Start()
    {
        // Start the coroutine to request permissions
        StartCoroutine(RequestWebcamPermission());
    }

    IEnumerator RequestWebcamPermission()
    {
        // Request webcam permission
        yield return Application.RequestUserAuthorization(UserAuthorization.WebCam);

        // Check if permission was granted
        if (Application.HasUserAuthorization(UserAuthorization.WebCam))
        {
            Debug.Log("Webcam permission granted.");
            InitializeWebcamDropdown();
        }
        else
        {
            Debug.Log("Webcam permission denied.");
        }
    }

    void InitializeWebcamDropdown()
    {
        // Get the list of available devices
        devices = WebCamTexture.devices;

        // Clear the dropdown options
        dropdown.ClearOptions();

        // Add device names to the dropdown
        foreach (var device in devices)
        {
            dropdown.options.Add(new TMP_Dropdown.OptionData(device.name));
        }

        // Add listener for when the dropdown value changes
        dropdown.onValueChanged.AddListener(delegate { DropdownValueChanged(dropdown); });

        // Start with the front-facing camera if available
        StartFrontFacingCamera();
    }

    void StartFrontFacingCamera()
    {
        foreach (var device in devices)
        {
            if (device.isFrontFacing)
            {
                StartWebcam(device.name);
                return;
            }
        }

        // If no front-facing camera is found, start the first device
        if (devices.Length > 0)
        {
            StartWebcam(devices[0].name);
        }
    }
    void DropdownValueChanged(TMP_Dropdown change)
    {
        // Stop the current webcam
        if (tex != null && tex.isPlaying)
        {
            tex.Stop();
        }

        // Start the new webcam
        StartWebcam(devices[change.value].name);
    }

    void StartWebcam(string deviceName)
    {
        // Create a new WebCamTexture with the selected device
        webcamTexture = new WebCamTexture(deviceName);
        if (!webcamTexture.isReadable)
            Debug.Log("Not readable");
        tex.Play();
    }

    void Update()
    {
        // Update the RenderTexture with the latest webcam frame
        if (webcamTexture != null && webcamTexture.didUpdateThisFrame)
        {
            if (!renderTexture || webcamTexture.width != renderTexture.width)
            {
                Debug.Log("Generating RenderTexture");
                // Initialize the RenderTexture
                renderTexture = new RenderTexture(webcamTexture.width, webcamTexture.height, 1, RenderTextureFormat.Default, RenderTextureReadWrite.sRGB);
                display.texture = renderTexture;
                aspectRatio = (float)webcamTexture.width / (float)webcamTexture.height;
                aspectRatioFitter.aspectRatio = aspectRatio;
            }

            Graphics.Blit(webcamTexture, renderTexture);
        }
    }
}
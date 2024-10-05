using UnityEngine;
using UnityEngine.UI;
using System.Collections;
using TMPro;

public class DropdownWidthAnimator : MonoBehaviour
{
    public RectTransform rectTransform;
    public TMP_Dropdown dropdown;
    public float animationDuration = 0.25f;

    public bool wasExpanded = false;

    private Coroutine currentCoroutine;

    private void Update()
    {
        if (dropdown.IsExpanded && !wasExpanded)
            OnClicked();
        if (!dropdown.IsExpanded && wasExpanded)
            OnClosed();

        wasExpanded = dropdown.IsExpanded;

    }
    void OnClosed()
    {
        if (currentCoroutine != null)
            StopCoroutine(currentCoroutine);
        currentCoroutine = StartCoroutine(AnimateWidth(rectTransform.rect.width, 30));
    }


    void OnClicked()
    {
        if (currentCoroutine != null)
            StopCoroutine(currentCoroutine);
        currentCoroutine = StartCoroutine(AnimateWidth(rectTransform.rect.width, 200));
    }


    IEnumerator AnimateWidth(float from, float to)
    {
        float elapsedTime = 0f;
        while (elapsedTime < animationDuration)
        {
            float newWidth = EaseOutQuad(from,to, elapsedTime / animationDuration);
            rectTransform.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal, newWidth);
            elapsedTime += Time.deltaTime;
            yield return null;
        }
        rectTransform.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal, to);
    }

    public static float EaseOutQuad(float start, float end, float value)
    {
        value = Mathf.Clamp01(value); // Ensure value is between 0 and 1
        value = 1 - (1 - value) * (1 - value); // Quadratic ease out
        return Mathf.Lerp(start, end, value);
    }

}
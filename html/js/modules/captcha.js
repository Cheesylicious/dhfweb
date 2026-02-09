/**
 * captcha.js
 * Optimierte Version mit robuster Reset-Funktion.
 * Liefert ein Interface-Objekt zurück, um das Puzzle von außen zu steuern.
 */
function initCaptcha(containerId, onSuccess) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Falls bereits initialisiert, das bestehende Interface zurückgeben
    if (container._captchaInterface) {
        return container._captchaInterface;
    }

    const puzzleCore = document.createElement('div');
    puzzleCore.style.cssText = 'position:relative; width:100%; height:160px; background:#2c3e50; border-radius:5px; overflow:hidden; margin-top:10px;';

    const sliderTrack = document.createElement('div');
    sliderTrack.style.cssText = 'position:absolute; bottom:10px; left:10px; right:10px; height:30px; background:rgba(255,255,255,0.1); border-radius:15px;';

    const sliderHandle = document.createElement('div');
    sliderHandle.style.cssText = 'position:absolute; left:0; top:-5px; width:40px; height:40px; background:#3498db; border-radius:50%; cursor:pointer; display:grid; place-items:center; z-index:10; box-shadow:0 2px 5px rgba(0,0,0,0.3);';
    sliderHandle.innerHTML = '<span style="color:white; font-weight:bold; user-select:none;">→</span>';

    const piece = document.createElement('div');
    piece.style.cssText = 'position:absolute; top:40px; left:10px; width:45px; height:45px; background:#3498db; border-radius:5px; z-index:5; box-shadow:0 0 10px rgba(0,0,0,0.5);';

    const targetSlot = document.createElement('div');
    let targetX = Math.floor(Math.random() * (220 - 120 + 1)) + 120;
    targetSlot.style.cssText = `position:absolute; top:40px; left:${targetX}px; width:45px; height:45px; background:rgba(0,0,0,0.5); border-radius:5px; border:2px dashed #f1c40f;`;

    let isDragging = false;
    let startX = 0;

    const onStart = (e) => {
        isDragging = true;
        startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const x = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
        let deltaX = x - startX;
        const maxDelta = sliderTrack.offsetWidth - sliderHandle.offsetWidth;
        if (deltaX < 0) deltaX = 0;
        if (deltaX > maxDelta) deltaX = maxDelta;

        sliderHandle.style.left = deltaX + 'px';
        piece.style.left = (10 + deltaX) + 'px';
        if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        const currentPos = parseInt(piece.style.left);

        if (Math.abs(currentPos - targetX) < 7) {
            sliderHandle.style.background = '#2ecc71';
            piece.style.background = '#2ecc71';
            sliderHandle.innerHTML = '✓';
            sliderHandle.style.pointerEvents = 'none'; // Verhindert erneutes Schieben nach Erfolg
            if (onSuccess) onSuccess();
        } else {
            sliderHandle.style.left = '0px';
            piece.style.left = '10px';
        }
    };

    const attachEvents = () => {
        sliderHandle.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        sliderHandle.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    };

    const detachEvents = () => {
        sliderHandle.removeEventListener('mousedown', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        sliderHandle.removeEventListener('touchstart', onStart);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
    };

    const reset = () => {
        targetX = Math.floor(Math.random() * (220 - 120 + 1)) + 120;
        targetSlot.style.left = targetX + 'px';
        sliderHandle.style.left = '0px';
        sliderHandle.style.background = '#3498db';
        sliderHandle.innerHTML = '<span style="color:white; font-weight:bold;">→</span>';
        piece.style.left = '10px';
        piece.style.background = '#3498db';
        sliderHandle.style.pointerEvents = 'auto';
        attachEvents(); // Events wieder aktivieren
    };

    attachEvents();
    sliderTrack.appendChild(sliderHandle);
    puzzleCore.appendChild(targetSlot);
    puzzleCore.appendChild(piece);
    puzzleCore.appendChild(sliderTrack);
    container.appendChild(puzzleCore);

    const captchaInterface = { reset };
    container._captchaInterface = captchaInterface;
    return captchaInterface;
}
# Rauschunterdrückung im Call – Entscheidung

Stand: 24.10.2026. **Es gilt nur der Filter des Browsers**, für alle und ohne Auswahl.

## Was gilt

Das Mikrofon kommt mit den Standardwerten von livekit-client (`audioDefaults`): `echoCancellation`,
`noiseSuppression`, `autoGainControl` und – wo der Browser es kann – `voiceIsolation`. Das ist die
WebRTC-Unterdrückung: wirkt gut gegen gleichmäßiges Rauschen (Lüfter, Brummen), kaum gegen kurze, harte
Geräusche wie Tastaturklicks. Wer tippt, schaltet sich am besten stumm.

## Was wir versucht und wieder ausgebaut haben

Vom 15. bis 24.10.2026 gab es zusätzlich die Stufen „Mittel" und „Stark" mit DeepFilterNet3 (Paket
`deepfilternet3-noise-filter` als LiveKit-`TrackProcessor`, WASM + Modell ~24 MB, Commit `2d412a4`,
zurückgenommen). Gründe für den Rückbau:

- **Hörtest im echten Call:** kaum Gewinn, dafür hörbar verzerrte Stimmen.
- **Messung** (Paket-Code 1:1 in Node, je drei Stimmen auf Deutsch und Englisch, mit künstlichem Tippen):
  - Tippgeräusche in Sprechpausen sanken um 23–36 dB (Stufe 25 dB bzw. unbegrenzt).
  - Die Stimme entfernte sich dabei aber **weiter** vom sauberen Original als das ungefilterte Signal mit
    Tippen (SI-SDR z. B. 10,0 → 7,9 dB), leise Silben wurden in 2–4 % der Fälle fast ganz weggeschnitten,
    der Sprachpegel fiel um 1–2,5 dB.
  - Kein Sprachunterschied: Deutsch schnitt je nach Stimme mal besser, mal schlechter ab als Englisch.
    Trainiert ist die DeepFilterNet-Reihe auf den DNS-Challenge-Daten, die auch Deutsch enthalten.
  - Rechenzeit war kein Problem (Apple Silicon: ~0,2 ms je 10 ms Audio), dazu kamen ~41 ms Latenz.
- Aufwand: 24 MB fremdes Binary, Build-Schritt mit Download vom Server des Paketautors.

Ungeklärt blieb, wie viel der Verzerrung von der **Doppelverarbeitung** kam (Browser-Filter und
Pegelautomatik liefen vor DeepFilterNet3 weiter). Wer das Thema neu aufgreift: zuerst mit abgeschaltetem
`noiseSuppression`/`voiceIsolation` und milder Dämpfungsgrenze (6–12 dB) an echten Aufnahmen testen.
Krisp scheidet weiter aus (nur LiveKit Cloud).

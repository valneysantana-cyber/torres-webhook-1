# HubGenial — vídeo de lançamento (motion graphics em código)

Vídeo de campanha para redes sociais gerado 100% por código, sem editor de vídeo.
A animação é um `index.html` dirigido por tempo (`window.seek(t)`), o `render.js`
fotografa cada quadro com Chromium (Playwright) e o ffmpeg monta o MP4 H.264.

## Roteiro (30 s, 9:16)

| Cena | Tempo      | Conteúdo                                                                 |
|------|------------|--------------------------------------------------------------------------|
| 1    | 0,0–3,2 s  | Gancho: "Seu negócio ainda vive em 5 apps diferentes?" + chips do caos   |
| 2    | 3,2–6,6 s  | SITE · LOJA · CRM · ERP entrando em sequência                            |
| 3    | 6,6–10,0 s | "Em um só lugar" + reveal do logo hubgenial                              |
| 4    | 10,0–18,4 s| 6 cards: Site, Loja online, CRM, ERP (NF-e/NFS-e), Agenda, Concierge IA  |
| 5    | 18,4–22,4 s| "Feito para quem faz acontecer" + 9 segmentos (salão, clínica, petshop…) |
| 6    | 22,4–26,6 s| Planos: Vitrine 49,90 · Loja 99,90 · Gestão 179,90 · Empresa 399 · IA    |
| 7    | 26,6–30,0 s| CTA: "15 dias grátis" · Começar agora · hubgenial.com.br                 |

## Rodar no Mac

```bash
brew install ffmpeg          # uma vez
npm i -g playwright && npx playwright install chromium   # uma vez

cd marketing/hubgenial-launch-video
node render.js                       # 1080x1920 (Reels/TikTok/Shorts) → out/hubgenial-9x16.mp4
node render.js --format 1x1          # 1080x1080 (feed)
node render.js --format 4x5          # 1080x1350 (feed vertical)
node render.js --format 16x9         # 1920x1080 (YouTube)
node render.js --stills              # só PNGs de cenas-chave, para revisão rápida
```

Pré-visualizar no navegador: abrir `index.html?play=1` (loop em tempo real) ou
`index.html?t=12.5` (quadro parado no segundo 12,5).

## Personalizar

- **Cores, fonte e tamanhos**: bloco `:root` no topo do `index.html` (`--a1`, `--a2`, `--a3`, `--bg`).
- **Textos**: direto no HTML de cada `<section class="scene">`.
- **Tempos**: chamadas `scene('#sN', início, fim, …)` no `<script>`; `window.DURATION` é o total.
- **Logo**: o `<svg class="mark">` da cena 3. Troque pelo arquivo oficial quando houver.
- **Trilha sonora**: o MP4 sai com faixa de áudio silenciosa. No Instagram/TikTok, adicione um
  áudio em alta na hora de publicar (melhor para alcance). Para embutir uma música própria:

  ```bash
  ffmpeg -i out/hubgenial-9x16.mp4 -i trilha.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest out/final.mp4
  ```

## Legenda sugerida para o post

> Site, loja, CRM e ERP no mesmo lugar. Com Concierge IA atendendo no WhatsApp por você.
> Planos a partir de R$ 49,90/mês e 15 dias grátis para testar tudo. 👉 hubgenial.com.br
>
> #hubgenial #pequenasempresas #erp #crm #lojaonline #siteprofissional #empreendedorismo #gestao

## Fontes

Inter (SIL Open Font License) via `@fontsource/inter`, em `fonts/`.

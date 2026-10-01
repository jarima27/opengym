# La web de Tiza (tiza.fit)

Web estática pensada para convertir: portada, precios, preguntas frecuentes y páginas SEO
(comparativas, programas, guías), en español e inglés. Cada página es un archivo de texto
(Markdown) en `content/`. No hay que programar para cambiar textos ni para publicar páginas
nuevas: editas el archivo en GitHub, guardas, y la web se vuelve a publicar sola en un minuto.

```
landing/
  site.config.json        dominio, dirección de la app, precios, enlaces a las tiendas
  content/es/*.md         páginas en español (index.md es la portada)
  content/en/*.md         páginas en inglés
  content/*/_site.md      textos fijos: menú, pie, botones
  content/*/_cta.md       el bloque «Empieza gratis» del final de cada página
  content/_plantillas/    plantillas para páginas nuevas (comparativa, programa, guía)
  assets/                 estilos, script, logo, capturas reales de la app
  build.mjs               genera la web en landing/dist
```

## Publicarla (una vez)

Recomendado: **Cloudflare Pages** (gratis, rápido, sin servidor que mantener).

1. En Cloudflare → Workers & Pages → Crear → Pages → Conectar a Git → elige el repositorio.
2. Configuración de compilación:
   - Comando de compilación: `node landing/build.mjs`
   - Directorio de salida: `landing/dist`
   - Variable de entorno: `NODE_VERSION` = `20`
3. Dominio personalizado: `tiza.fit` (y `www.tiza.fit` si quieres).
4. La app va en otro subdominio, `app.tiza.fit` (es lo que pone `appUrl` en `site.config.json`).

A partir de ahí, **cada cambio que guardes en GitHub se publica solo**. Si una página tiene un
error, la compilación falla y la web que está en línea no cambia; el registro de Cloudflare dice
qué archivo y qué línea arreglar.

Netlify funciona igual (mismo comando y carpeta). Los archivos `_redirects` y `_headers` sirven
para los dos.

## Cambiar un texto

1. En GitHub, abre `landing/content/es/index.md` (o la página que sea) y pulsa el lápiz ✏️.
2. Cambia el texto. Guarda con «Commit changes».
3. En un minuto está en línea.

Los precios, los días de prueba, el dominio y la dirección de la app **no se escriben en las
páginas**: se cambian una vez en `site.config.json` y se actualizan en toda la web.

## Publicar una página nueva (SEO)

1. Copia una plantilla de `content/_plantillas/` (comparativa, programa o guía) a
   `content/es/` con un nombre en minúsculas y con guiones: `alternativa-a-fitbod.md` se publica en
   `tiza.fit/alternativa-a-fitbod/`.
2. Rellena el título (menos de 60 caracteres) y la descripción (50–160): es lo que sale en Google.
3. Quita la línea `draft: true` cuando esté lista.

Con `menu: guias` arriba, la página aparece sola en el pie de todas las páginas y en el mapa del
sitio para Google. Si tiene versión en inglés, pon en cada una la ruta de la otra en
`translation:` y Google enseñará a cada persona la de su idioma.

## Cómo se escribe una página

Arriba, entre dos líneas `---`, los datos de la página:

| Dato | Para qué |
|---|---|
| `title` | El título en Google y en la pestaña |
| `description` | El resumen en Google y al compartir el enlace |
| `nav_title` | El nombre corto en el pie y en la miga de pan |
| `menu: guias` | La pone en «Guías» del pie |
| `translation` | La misma página en el otro idioma, p. ej. `/en/hevy-alternative/` |
| `draft: true` | No se publica (borrador) |
| `cta: false` | Sin el bloque «Empieza gratis» del final |
| `noindex: true` | Que Google no la indexe |

Debajo, el texto en Markdown: `#` títulos, `**negrita**`, `*cursiva*`, `- listas`,
`[enlaces](/ruta/)`, tablas con `|`. Y lo propio de esta web:

- **Botones**: una línea que solo tiene enlaces se dibuja como botones (el primero, el principal):
  `[Empieza gratis](app) [Ver la guía](/importar-desde-strong-y-hevy/)`
- **Enlaces especiales**: `(app)` es el registro en la app, `(app:login)` entrar, `(ios)` y
  `(android)` las tiendas (mientras estén vacías en `site.config.json`, el texto sale sin enlace).
- **Capturas de la app**: `![Descripción](phone:coach)` pone una captura real en un marco de móvil,
  en el idioma de la página. Hay: `home`, `workout`, `sets`, `coach`, `stats`, `library`, `import`.
- **Palabras que se rellenan solas**: `{{price.monthly}}`, `{{price.annual}}`,
  `{{price.annualMonthly}}`, `{{price.saving}}`, `{{trial_days}}`, `{{name}}`, `{{domain}}`,
  `{{source}}`, `{{year}}`.
- **Estilos de párrafo**: añade `{.fine}` al final para letra pequeña, `{.eyebrow}` para la
  etiqueta amarilla de encima de un título, `{.price}` para un precio.
- **Notas para ti**: `<!-- esto no se publica -->`.

### Secciones

Un bloque entre `::: nombre` y `:::` es una sección. Lo que haya antes del primer `###` es su
introducción. `id=precios` le da un ancla (`/#precios`); en `alt=` los espacios van con `_`.

| Sección | Qué dibuja |
|---|---|
| `::: hero image=workout` | La cabecera: texto a un lado, captura al otro |
| `::: split image=coach` | Lo mismo más abajo; con `reverse`, la captura a la izquierda |
| `::: strip` | Una lista como fila de datos cortos |
| `::: cards` | Una tarjeta por cada `###`; `### Nombre {.featured}` es la destacada |
| `::: cards pricing` | Las tarjetas de precios |
| `::: steps` | Un paso numerado por cada `###` |
| `::: faq` | Una pregunta por cada `###` (Google las puede mostrar en los resultados) |
| `::: testimonials` | Una tarjeta por cada cita `>`; sin citas, no se muestra |
| `::: cta` | El bloque final con el botón principal |
| `::: note` | Un recuadro de aviso |

## Enlaces para creadores y entrenadores

Crea el código en la app (Admin → Creator codes). Su enlace es cualquiera de estos:

- `https://tiza.fit/?ref=LUCIA` (o cualquier página de la web con `?ref=LUCIA`)
- `https://tiza.fit/r/LUCIA` (redirige al anterior)

La web enseña un aviso con los días extra que da el código y lo pasa a la app, que lo guarda al
registrarse; en PostHog y en el panel de admin ves cuántos registros y pagos trae cada código. Las
etiquetas `utm_source`, `utm_medium` y `utm_campaign` de tus anuncios pasan igual. Una visita sin
campaña llega a la app con `utm_medium=landing` y `utm_content` igual a la página desde la que
pulsaron, así sabes qué página convierte.

## Estadística de la web

La web no lleva cookies ni scripts de terceros, así que no necesita banner de cookies. Lo que
importa (registros, pruebas, pagos) ya lo mide la app con su origen. Si aun así quieres medir
visitas, pega el código de tu herramienta en `headHtml` de `site.config.json`. Si esa herramienta
usa cookies, tendrás que añadir un banner de consentimiento.

## Antes de publicar

- **Las páginas legales** (`privacidad`, `terminos`, `aviso-legal`) son borradores: rellena cada
  `[RELLENAR …]`, que las revise un abogado y quita `draft: true`. El aviso legal es obligatorio en
  España para una web con actividad económica.
- **Las promesas** («sin anuncios», «no vendemos tus datos», «cancela cuando quieras») tienen que
  ser ciertas para tu negocio. Si alguna cambia, cámbiala aquí también.
- **Las comparativas**: comprueba en la web de la otra app cualquier dato que des sobre ella.
- **Testimonios**: solo reales y con permiso.

## Para quien programe

```bash
node landing/build.mjs            # genera landing/dist
node landing/build.mjs --drafts   # con los borradores, para verlos
node --test landing/test/*.test.mjs
cd landing/dist && python3 -m http.server 8000   # verla en http://localhost:8000
```

Sin dependencias: Node 18 o más. Las capturas de `assets/screens` son de la app real en modo
demo (`VITE_DEMO=1`), a 640 px de ancho en WebP; si la app cambia mucho, conviene repetirlas.

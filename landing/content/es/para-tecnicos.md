---
title: Tiza para técnicos · código abierto y autoalojable
description: Tiza es código abierto (AGPL-3.0), una versión modificada de openGym. Puedes leer el código, auditarlo o montar tu propio servidor.
nav_title: Para técnicos
translation: /en/for-developers/
cta: false
---

# Para técnicos

Tiza es **código abierto**: una versión modificada de [openGym]({{upstream_url}}), de Duarte Santos, con licencia AGPL-3.0. Todo el código que hace funcionar Tiza, incluido el servicio que usas en {{domain}}, está publicado.

## Qué puedes hacer con el código

- **Leerlo y auditarlo**: qué se guarda, qué se envía y a dónde. [Ver el código fuente]({{source}}).
- **Montar tu propio servidor**: dos contenedores Docker y una carpeta de datos que es tuya. La guía de autoalojamiento está en el repositorio (docs/SELF_HOSTING.md).
- **Conectarlo a tus herramientas**: hay una API documentada y un servidor MCP de solo lectura para asistentes de IA.

## Cómo está hecho

- Frontend en React y Vite, que funciona sin conexión e instalable como app.
- Backend en Node sin framework; los datos son ficheros JSON con escritura atómica.
- Inicio de sesión con passkeys o contraseña.
- El motor de progresión es determinista y está cubierto por tests: la IA propone el plan, pero el peso de cada día lo calcula siempre ese motor.

¿Prefieres que te lo llevemos nosotros? [Crea tu cuenta](app) y listo.

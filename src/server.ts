import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { AdaptadorOpenAI, MensajeChat, HerramientaDefinicion } from "./llm/adapter";
import {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
  ContextoHerramienta,
} from "./tools/proveedor";

const PORT = Number(process.env.PORT) || 3000;
const adapter = new AdaptadorOpenAI();

// Definición de herramientas registradas para el agente
const HERRAMIENTAS_AGENTE: HerramientaDefinicion[] = [
  {
    nombre: "proveedor_leer_solicitud",
    descripcion: "Lee la solicitud del cliente para un caso específico (ej. co-industrias-delta, ec-corp-andina, hn-agroexport-sula, pa-logistica-istmo).",
    esquemaZod: z.object(leer_solicitud.args),
  },
  {
    nombre: "proveedor_mapear_campos",
    descripcion: "Mapea los campos exigidos por el cliente con los datos del repositorio maestro de Periferia IT Group.",
    esquemaZod: z.object(mapear_campos.args),
  },
  {
    nombre: "proveedor_generar_formulario",
    descripcion: "Escribe físicamente el formulario diligenciado (Excel, PDF o Markdown para portal web) en el directorio out/.",
    esquemaZod: z.object(generar_formulario.args),
  },
  {
    nombre: "proveedor_armar_paquete",
    descripcion: "Genera el checklist de verificación de soportes, copia archivos adjuntos y redacta el borrador del correo de envío.",
    esquemaZod: z.object(armar_paquete.args),
  },
  {
    nombre: "proveedor_simular_envio",
    descripcion: "Simula el envío final del paquete completo al cliente (requiere confirmación humana previa explícita).",
    esquemaZod: z.object(simular_envio.args),
  },
];

// Mapa ejecutor de herramientas
const MAPA_HERRAMIENTAS: Record<string, any> = {
  proveedor_leer_solicitud: leer_solicitud,
  proveedor_mapear_campos: mapear_campos,
  proveedor_generar_formulario: generar_formulario,
  proveedor_armar_paquete: armar_paquete,
  proveedor_simular_envio: simular_envio,
};

// Almacenamiento temporal de sesiones
const sesionesChat = new Map<string, MensajeChat[]>();

// Cargar el System Prompt desde agent/prompt.md
function obtenerSystemPrompt(): string {
  const rutaPrompt = path.join(process.cwd(), "agent", "prompt.md");
  if (fs.existsSync(rutaPrompt)) {
    return fs.readFileSync(rutaPrompt, "utf-8");
  }
  return "Eres un asistente de registro de proveedores para Periferia IT Group S.A.S.";
}

// Ciclo del Agente con límite de iteraciones (Agent Loop)
async function procesarMensajeAgente(sessionId: string, mensajeUsuario: string): Promise<string> {
  const rootDir = process.cwd();
  const ctx: ContextoHerramienta = {
    directory: rootDir,
    sessionId: sessionId,
  };

  if (!sesionesChat.has(sessionId)) {
    sesionesChat.set(sessionId, [
      { role: "system", content: obtenerSystemPrompt() },
    ]);
  }

  const historial = sesionesChat.get(sessionId)!;
  historial.push({ role: "user", content: mensajeUsuario });

  const MAX_ITERACIONES = 10;
  let iteracion = 0;

  while (iteracion < MAX_ITERACIONES) {
    iteracion++;
    console.log(`\n🤖 [Agente - Sesión ${sessionId}] Iteración ${iteracion}/${MAX_ITERACIONES}...`);

    const respuestaLLM = await adapter.enviar(historial, HERRAMIENTAS_AGENTE);

    if (respuestaLLM.llamadasHerramientas && respuestaLLM.llamadasHerramientas.length > 0) {
      historial.push({
        role: "assistant",
        content: respuestaLLM.contenido || "",
        tool_calls: respuestaLLM.llamadasHerramientas,
      });

      for (const llamada of respuestaLLM.llamadasHerramientas) {
        const { id, nombre, argumentos } = llamada;
        console.log(`  🔧 Ejecutando herramienta: ${nombre} (${id})`);

        const herramienta = MAPA_HERRAMIENTAS[nombre];
        let resultado = "";

        if (herramienta) {
          try {
            resultado = await herramienta.execute(argumentos, ctx);
          } catch (err: any) {
            resultado = JSON.stringify({ ok: false, error: err.message });
          }
        } else {
          resultado = JSON.stringify({ ok: false, error: `Herramienta '${nombre}' no encontrada.` });
        }

        historial.push({
          role: "tool",
          name: nombre,
          tool_call_id: id,
          content: resultado,
        });
      }
    } else {
      const textoRespuesta = respuestaLLM.contenido || "Proceso completado.";
      historial.push({ role: "assistant", content: textoRespuesta });
      return textoRespuesta;
    }
  }

  return "Se alcanzó el límite de iteraciones del agente sin finalizar la solicitud.";
}

// Servidor HTTP con Bun
Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Servir la interfaz gráfica web en la raíz /
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const rutaHtml = path.join(process.cwd(), "public", "index.html");
      if (fs.existsSync(rutaHtml)) {
        return new Response(fs.readFileSync(rutaHtml), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // Endpoint de verificación de estado
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", servicio: "Agente Proveedores Periferia IT" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Endpoint principal del Chat
    if (req.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await req.json();
        const sessionId = body.sessionId || "sesion-default";
        const message = body.message || "";

        if (!message) {
          return new Response(JSON.stringify({ error: "El campo 'message' es obligatorio." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const respuestaAgente = await procesarMensajeAgente(sessionId, message);

        return new Response(JSON.stringify({ respuesta: respuestaAgente, sessionId }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Ruta no encontrada", { status: 404 });
  },
});

console.log(`\n=================================================`);
console.log(`🚀 SERVIDOR BACKEND ACTIVO EN PUERTO: ${PORT}`);
console.log(`  • Interfaz Web: GET http://localhost:${PORT}/`);
console.log(`  • Health check: GET http://localhost:${PORT}/health`);
console.log(`  • Chat API:     POST http://localhost:${PORT}/api/chat`);
console.log(`=================================================\n`);
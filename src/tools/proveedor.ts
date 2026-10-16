import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

// ==========================================
// TIPOS E INTERFACES BASE
// ==========================================
export interface ContextoHerramienta {
  directory: string; // Ruta raíz del proyecto
  sessionId: string;
}

export interface RespuestaHerramienta<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ==========================================
// FUNCIÓN AUXILIAR DE AUDITORÍA Y LOGS (RN5)
// ==========================================
function registrarLog(
  ctx: ContextoHerramienta,
  caso: string,
  herramienta: string,
  ok: boolean,
  resumen: string
) {
  try {
    const dirCasoOut = path.join(ctx.directory, "out", caso);
    if (!fs.existsSync(dirCasoOut)) {
      fs.mkdirSync(dirCasoOut, { recursive: true });
    }
    const logPath = path.join(dirCasoOut, "log.jsonl");
    const logEntry = JSON.stringify({
      ts: new Date().toISOString(),
      herramienta,
      ok,
      resumen,
    }) + "\n";

    fs.appendFileSync(logPath, logEntry, "utf-8");
  } catch (err) {
    console.error(`[RN5 ERROR] No se pudo escribir en log.jsonl de ${caso}:`, err);
  }
}

// Auxiliar para obtener valor de un objeto por ruta con notación de puntos (ej. "representante_legal.nombre")
function getNestedValue(obj: any, pathStr: string): any {
  return pathStr.split(".").reduce((prev, curr) => (prev ? prev[curr] : undefined), obj);
}

// ==========================================
// 1. HERRAMIENTA: proveedor_leer_solicitud (HU-1 / P0)
// ==========================================
export const leer_solicitud = {
  description: "Lee la solicitud del cliente, identifica el formato, país y la lista de campos y soportes exigidos.",
  args: {
    caso: z.string().describe("Nombre del directorio del caso en fixtures/reto-01/casos/"),
  },
  async execute(
    args: { caso: string },
    ctx: ContextoHerramienta
  ): Promise<string> {
    try {
      const baseCaso = path.join(ctx.directory, "fixtures", "reto-01", "casos", args.caso);

      // 1. Leer solicitud.json
      const rutaSolicitud = path.join(baseCaso, "solicitud.json");
      if (!fs.existsSync(rutaSolicitud)) {
        const errStr = `No existe solicitud.json para el caso '${args.caso}'`;
        registrarLog(ctx, args.caso, "proveedor_leer_solicitud", false, errStr);
        return JSON.stringify({ ok: false, error: errStr });
      }

      const solicitud = JSON.parse(fs.readFileSync(rutaSolicitud, "utf-8"));
      const formato = solicitud.formato as "xlsx" | "pdf" | "portal";

      // 2. Leer plantilla según el formato
      let campos: string[] = [];
      if (formato === "xlsx") {
        const rutaPlantilla = path.join(baseCaso, "plantilla-celdas.json");
        if (fs.existsSync(rutaPlantilla)) {
          const plantillaCeldas = JSON.parse(fs.readFileSync(rutaPlantilla, "utf-8"));
          campos = plantillaCeldas.map((item: any) => item.etiqueta);
        }
      } else if (formato === "pdf" || formato === "portal") {
        const rutaPlantilla = path.join(baseCaso, "plantilla-campos.json");
        if (fs.existsSync(rutaPlantilla)) {
          const plantillaCampos = JSON.parse(fs.readFileSync(rutaPlantilla, "utf-8"));
          campos = plantillaCampos.map((item: any) => item.etiqueta);
        }
      }

      // 3. Leer soportes exigidos
      let soportes: string[] = [];
      const rutaSoportes = path.join(baseCaso, "soportes-exigidos.json");
      if (fs.existsSync(rutaSoportes)) {
        soportes = JSON.parse(fs.readFileSync(rutaSoportes, "utf-8"));
      }

      const resultado = {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato,
        campos,
        soportes,
      };

      registrarLog(
        ctx,
        args.caso,
        "proveedor_leer_solicitud",
        true,
        `Solicitud leída correctamente: ${campos.length} campos y ${soportes.length} soportes.`
      );

      return JSON.stringify({ ok: true, data: resultado });
    } catch (error: any) {
      const errMessage = error?.message || "Error al leer la solicitud";
      registrarLog(ctx, args.caso, "proveedor_leer_solicitud", false, errMessage);
      return JSON.stringify({ ok: false, error: errMessage });
    }
  },
};

// ==========================================
// 2. HERRAMIENTA: proveedor_mapear_campos (HU-2 / RN1)
// ==========================================
export const mapear_campos = {
  description: "Cruza las etiquetas solicitadas con el repositorio maestro aplicando el glosario de sinónimos y las reglas por país.",
  args: {
    caso: z.string().describe("Nombre del directorio del caso"),
    campos: z.array(z.string()).describe("Lista de etiquetas de campos solicitadas"),
  },
  async execute(
    args: { caso: string; campos: string[] },
    ctx: ContextoHerramienta
  ): Promise<string> {
    try {
      const repoDir = path.join(ctx.directory, "fixtures", "reto-01", "repositorio");
      const rutaMaestro = path.join(repoDir, "maestro.json");
      const rutaGlosario = path.join(ctx.directory, "fixtures", "reto-01", "glosario-campos.json");
      const rutaSolicitud = path.join(ctx.directory, "fixtures", "reto-01", "casos", args.caso, "solicitud.json");

      if (!fs.existsSync(rutaMaestro) || !fs.existsSync(rutaSolicitud)) {
        return JSON.stringify({ ok: false, error: "Archivos de maestro o solicitud no encontrados." });
      }

      const maestro = JSON.parse(fs.readFileSync(rutaMaestro, "utf-8"));
      const glosario = fs.existsSync(rutaGlosario) ? JSON.parse(fs.readFileSync(rutaGlosario, "utf-8")) : {};
      const solicitud = JSON.parse(fs.readFileSync(rutaSolicitud, "utf-8"));
      const paisCliente = solicitud.pais;

      const llenos: Array<{ etiqueta: string; clave: string; valor: any }> = [];
      const faltantes: Array<{ etiqueta: string; motivo: string }> = [];
      const requiere_confirmacion: Array<{ etiqueta: string; clave: string; valor: any; nota: string }> = [];

      for (const etiqueta of args.campos) {
        // Resolver clave desde el glosario
        const claveMaestro = glosario[etiqueta];

        if (!claveMaestro) {
          faltantes.push({ etiqueta, motivo: "No existe traducción en el glosario de campos" });
          continue;
        }

        const valor = getNestedValue(maestro, claveMaestro);

        if (valor === undefined || valor === null || valor === "") {
          faltantes.push({ etiqueta, motivo: `La clave '${claveMaestro}' está vacía en el maestro` });
          continue;
        }

        // Regla RN1: Identificador tributario según el país del cliente
        const esIdentificadorFiscal =
          claveMaestro === "nit" ||
          ["NIT", "RUC", "RTN", "Identificación tributaria", "Número de identificación fiscal"].includes(etiqueta);

        if (esIdentificadorFiscal && paisCliente !== "CO") {
          const idNombre = paisCliente === "HN" ? "RTN" : "RUC";
          requiere_confirmacion.push({
            etiqueta,
            clave: claveMaestro,
            valor,
            nota: `Cliente de ${paisCliente} exige ${idNombre}. Periferia solo cuenta con NIT colombiano (${valor}). Se asigna como identificador extranjero y requiere confirmación.`,
          });
        } else {
          llenos.push({ etiqueta, clave: claveMaestro, valor });
        }
      }

      const data = { llenos, faltantes, requiere_confirmacion };
      registrarLog(
        ctx,
        args.caso,
        "proveedor_mapear_campos",
        true,
        `Mapeo completado: ${llenos.length} llenos, ${faltantes.length} faltantes, ${requiere_confirmacion.length} requieren confirmación.`
      );

      return JSON.stringify({ ok: true, data });
    } catch (error: any) {
      const errMessage = error?.message || "Error al mapear campos";
      registrarLog(ctx, args.caso, "proveedor_mapear_campos", false, errMessage);
      return JSON.stringify({ ok: false, error: errMessage });
    }
  },
};

// ==========================================
// 3. HERRAMIENTA: proveedor_generar_formulario (HU-3 / P0-P2)
// ==========================================
export const generar_formulario = {
  description: "Genera físicamente el formulario diligenciado en Excel (xlsx), PDF o Markdown para Portales Web.",
  args: {
    caso: z.string().describe("Nombre del directorio del caso"),
    mapeo: z.object({
      llenos: z.array(z.any()),
      faltantes: z.array(z.any()),
      requiere_confirmacion: z.array(z.any()),
    }),
  },
  async execute(
    args: { caso: string; mapeo: any },
    ctx: ContextoHerramienta
  ): Promise<string> {
    try {
      const baseCaso = path.join(ctx.directory, "fixtures", "reto-01", "casos", args.caso);
      const rutaSolicitud = path.join(baseCaso, "solicitud.json");
      const solicitud = JSON.parse(fs.readFileSync(rutaSolicitud, "utf-8"));
      const formato = solicitud.formato;

      const outCasoDir = path.join(ctx.directory, "out", args.caso);
      if (!fs.existsSync(outCasoDir)) {
        fs.mkdirSync(outCasoDir, { recursive: true });
      }

      // Mapa rápido de valores a escribir
      const valoresMap: Record<string, any> = {};
      args.mapeo.llenos.forEach((item: any) => { valoresMap[item.etiqueta] = item.valor; });
      args.mapeo.requiere_confirmacion.forEach((item: any) => { valoresMap[item.etiqueta] = item.valor; });

      // ----------------------------------------------------
      // CASO P0: EXCEL (xlsx)
      // ----------------------------------------------------
      if (formato === "xlsx") {
        const rutaPlantilla = path.join(baseCaso, "plantilla-celdas.json");
        const plantillaCeldas = JSON.parse(fs.readFileSync(rutaPlantilla, "utf-8"));

        const workbook = new ExcelJS.Workbook();

        // Agrupar por hoja
        const hojasMap: Record<string, any[]> = {};
        for (const item of plantillaCeldas) {
          if (!hojasMap[item.hoja]) hojasMap[item.hoja] = [];
          hojasMap[item.hoja].push(item);
        }

        for (const [nombreHoja, celdas] of Object.entries(hojasMap)) {
          const sheet = workbook.addWorksheet(nombreHoja);
          for (const item of celdas) {
            sheet.getCell(item.celda_etiqueta).value = item.etiqueta;
            sheet.getCell(item.celda_valor).value = valoresMap[item.etiqueta] ?? "";
          }
        }

        const outPath = path.join(outCasoDir, "formulario.xlsx");
        await workbook.xlsx.writeFile(outPath);

        registrarLog(ctx, args.caso, "proveedor_generar_formulario", true, `Formulario Excel generado en ${outPath}`);
        return JSON.stringify({ ok: true, data: { ruta: `out/${args.caso}/formulario.xlsx`, formato: "xlsx" } });
      }

      // ----------------------------------------------------
      // CASO P1: PDF
      // ----------------------------------------------------
      if (formato === "pdf") {
        const outPath = path.join(outCasoDir, "formulario.pdf");
        const doc = new PDFDocument({ margin: 50 });
        const writeStream = fs.createWriteStream(outPath);
        doc.pipe(writeStream);

        doc.fontSize(16).text(`Formulario de Registro - ${solicitud.cliente}`, { align: "center" });
        doc.moveDown();

        const rutaPlantilla = path.join(baseCaso, "plantilla-campos.json");
        const plantillaCampos = JSON.parse(fs.readFileSync(rutaPlantilla, "utf-8"));

        doc.fontSize(11);
        for (const item of plantillaCampos) {
          const val = valoresMap[item.etiqueta] ?? "[DATO FALTANTE]";
          doc.text(`${item.etiqueta}: `, { continued: true }).font("Helvetica-Bold").text(String(val)).font("Helvetica");
          doc.moveDown(0.5);
        }

        doc.end();

        await new Promise((resolve) => writeStream.on("finish", resolve));

        registrarLog(ctx, args.caso, "proveedor_generar_formulario", true, `Formulario PDF generado en ${outPath}`);
        return JSON.stringify({ ok: true, data: { ruta: `out/${args.caso}/formulario.pdf`, formato: "pdf" } });
      }

      // ----------------------------------------------------
      // CASO P2: PORTAL WEB
      // ----------------------------------------------------
      if (formato === "portal") {
        const outPath = path.join(outCasoDir, "valores-portal.md");
        let content = `# Valores para copiar en Portal Web (${solicitud.cliente})\n\n`;
        content += `| Campo | Valor |\n| --- | --- |\n`;

        const rutaPlantilla = path.join(baseCaso, "plantilla-campos.json");
        const plantillaCampos = JSON.parse(fs.readFileSync(rutaPlantilla, "utf-8"));

        for (const item of plantillaCampos) {
          const val = valoresMap[item.etiqueta] ?? "**[FALTANTE]**";
          content += `| ${item.etiqueta} | ${val} |\n`;
        }

        fs.writeFileSync(outPath, content, "utf-8");

        registrarLog(ctx, args.caso, "proveedor_generar_formulario", true, "Formato portal no soportado. Se generó valores-portal.md");
        return JSON.stringify({
          ok: true,
          data: {
            ruta: `out/${args.caso}/valores-portal.md`,
            formato: "portal",
            mensaje: "Formato de portal web no soportado directamente para llenado automático. Se generaron los valores en Markdown.",
          },
        });
      }

      return JSON.stringify({ ok: false, error: `Formato '${formato}' no reconocido.` });
    } catch (error: any) {
      const errMessage = error?.message || "Error al generar formulario";
      registrarLog(ctx, args.caso, "proveedor_generar_formulario", false, errMessage);
      return JSON.stringify({ ok: false, error: errMessage });
    }
  },
};

// ==========================================
// 4. HERRAMIENTA: proveedor_armar_paquete (HU-4 / RN2 / RN3)
// ==========================================
export const armar_paquete = {
  description: "Copia los soportes requeridos, evalúa vigencias (RN3), redacta borrador de correo sin datos bancarios (RN2) y construye el checklist.",
  args: {
    caso: z.string().describe("Nombre del directorio del caso"),
  },
  async execute(
    args: { caso: string },
    ctx: ContextoHerramienta
  ): Promise<string> {
    try {
      const fechaEjecucion = new Date("2026-09-03"); // Fecha de evaluación según el enunciado
      const baseCaso = path.join(ctx.directory, "fixtures", "reto-01", "casos", args.caso);
      const outPaqueteDir = path.join(ctx.directory, "out", args.caso, "paquete");

      if (!fs.existsSync(outPaqueteDir)) {
        fs.mkdirSync(outPaqueteDir, { recursive: true });
      }

      // 1. Cargar metadatos
      const solicitud = JSON.parse(fs.readFileSync(path.join(baseCaso, "solicitud.json"), "utf-8"));
      const soportesExigidos: string[] = JSON.parse(fs.readFileSync(path.join(baseCaso, "soportes-exigidos.json"), "utf-8"));
      const indexSoportes = JSON.parse(fs.readFileSync(path.join(ctx.directory, "fixtures", "reto-01", "repositorio", "soportes", "index.json"), "utf-8"));

      let listoParaFirma = true;
      const checklist: Array<{ soporte: string; estado: string; detalle: string }> = [];
      const soportesAdjuntados: string[] = [];

      // Copy formulario generado previamente
      const outCasoDir = path.join(ctx.directory, "out", args.caso);
      const formExt = solicitud.formato === "xlsx" ? "formulario.xlsx" : solicitud.formato === "pdf" ? "formulario.pdf" : "valores-portal.md";
      const formOrigen = path.join(outCasoDir, formExt);
      if (fs.existsSync(formOrigen)) {
        fs.copyFileSync(formOrigen, path.join(outPaqueteDir, formExt));
      }

      // 2. Procesar soportes requeridos
      for (const tipoSoporte of soportesExigidos) {
        const sopMeta = indexSoportes.find((item: any) => item.tipo === tipoSoporte);

        if (!sopMeta) {
          listoParaFirma = false;
          checklist.push({
            soporte: tipoSoporte,
            estado: "AUSENTE",
            detalle: "El soporte exigido no existe en el repositorio de la empresa",
          });
          continue;
        }

        // Copiar archivo de soporte
        const rutaSopOrigen = path.join(ctx.directory, "fixtures", "reto-01", "repositorio", "soportes", sopMeta.archivo);
        if (fs.existsSync(rutaSopOrigen)) {
          fs.copyFileSync(rutaSopOrigen, path.join(outPaqueteDir, sopMeta.archivo));
          soportesAdjuntados.push(sopMeta.descripcion);
        }

        // Evaluar vigencia (RN3)
        if (sopMeta.vigencia_hasta && sopMeta.vigencia_hasta !== "no aplica") {
          const fechaVig = new Date(sopMeta.vigencia_hasta);
          if (fechaVig < fechaEjecucion) {
            listoParaFirma = false;
            checklist.push({
              soporte: tipoSoporte,
              estado: "VENCIDO",
              detalle: `Expiró el ${sopMeta.vigencia_hasta} (Fecha actual: 2026-09-03)`,
            });
            continue;
          }
        }

        checklist.push({
          soporte: tipoSoporte,
          estado: "OK",
          detalle: `Vigente hasta: ${sopMeta.vigencia_hasta ?? "Permanente"}`,
        });
      }

      // 3. Generar checklist.md
      let checklistMd = `# Checklist de Paquete para Firma (${solicitud.cliente})\n\n`;
      checklistMd += `**Estado listo para firma:** ${listoParaFirma ? "✅ VISTO BUENO" : "❌ BLOQUEADO"}\n\n`;
      checklistMd += `| Soporte | Estado | Detalle |\n| --- | --- | --- |\n`;
      for (const chk of checklist) {
        checklistMd += `| ${chk.soporte} | ${chk.estado} | ${chk.detalle} |\n`;
      }
      fs.writeFileSync(path.join(outPaqueteDir, "checklist.md"), checklistMd, "utf-8");

      // 4. Generar borrador-correo.md (RN2: Omitir estrictamente datos bancarios)
      let correoMd = `# Borrador de Correo de Respuesta\n\n`;
      correoMd += `**Para:** ${solicitud.de}\n`;
      correoMd += `**Asunto:** Re: ${solicitud.asunto}\n\n`;
      correoMd += `Estimados ${solicitud.cliente},\n\n`;
      correoMd += `Adjunto a este mensaje remitimos el formulario de registro debidamente diligenciado y firmado por nuestro representante legal, junto con los siguientes documentos de soporte:\n\n`;
      for (const adj of soportesAdjuntados) {
        correoMd += `- ${adj}\n`;
      }
      correoMd += `\nQuedamos atentos a la confirmación de la creación de nuestro perfil de proveedor.\n\n`;
      correoMd += `Cordialmente,\nPeriferia IT Group S.A.S.`;
      fs.writeFileSync(path.join(outPaqueteDir, "borrador-correo.md"), correoMd, "utf-8");

      const resData = {
        ruta: `out/${args.caso}/paquete/`,
        listo_para_firma: listoParaFirma,
        checklist,
      };

      registrarLog(
        ctx,
        args.caso,
        "proveedor_armar_paquete",
        true,
        `Paquete armado en out/${args.caso}/paquete/. Listo para firma: ${listoParaFirma}`
      );

      return JSON.stringify({ ok: true, data: resData });
    } catch (error: any) {
      const errMessage = error?.message || "Error al armar paquete";
      registrarLog(ctx, args.caso, "proveedor_armar_paquete", false, errMessage);
      return JSON.stringify({ ok: false, error: errMessage });
    }
  },
};

// ==========================================
// 5. HERRAMIENTA: proveedor_simular_envio (HU-4 / RN4)
// ==========================================
export const simular_envio = {
  description: "Simula el envío final del paquete solo si se cuenta con la confirmación explícita del operador humano (RN4).",
  args: {
    caso: z.string().describe("Nombre del directorio del caso"),
    confirmado: z.boolean().describe("Confirmación explícita previa entregada por el usuario en el chat"),
  },
  async execute(
    args: { caso: string; confirmado: boolean },
    ctx: ContextoHerramienta
  ): Promise<string> {
    try {
      // Regla RN4: Bloqueo estricto sin confirmación previa
      if (!args.confirmado) {
        const err = "Acción bloqueada: Se requiere la confirmación explícita del operador humano en el turno anterior para ejecutar el envío.";
        registrarLog(ctx, args.caso, "proveedor_simular_envio", false, err);
        return JSON.stringify({ ok: false, error: err });
      }

      const outCasoDir = path.join(ctx.directory, "out", args.caso);
      if (!fs.existsSync(outCasoDir)) {
        fs.mkdirSync(outCasoDir, { recursive: true });
      }

      const envioPath = path.join(outCasoDir, "ENVIO-SIMULADO.md");
      const contenido = `# Registro de Envío Simulado\n\n` +
        `- **Caso:** ${args.caso}\n` +
        `- **Fecha/Hora:** ${new Date().toISOString()}\n` +
        `- **Estado:** ENVÍO SIMULADO EXITOSAMENTE\n` +
        `- **Confirmación Humana:** REGISTRADA\n`;

      fs.writeFileSync(envioPath, contenido, "utf-8");

      registrarLog(ctx, args.caso, "proveedor_simular_envio", true, `Envío simulado generado en ${envioPath}`);

      return JSON.stringify({
        ok: true,
        data: {
          ruta: `out/${args.caso}/ENVIO-SIMULADO.md`,
          mensaje: "Envío simulado registrado exitosamente tras confirmación humana.",
        },
      });
    } catch (error: any) {
      const errMessage = error?.message || "Error al simular envío";
      registrarLog(ctx, args.caso, "proveedor_simular_envio", false, errMessage);
      return JSON.stringify({ ok: false, error: errMessage });
    }
  },
};
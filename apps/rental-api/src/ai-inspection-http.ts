/** 员工原检查操作的精确宿主路由。请求仍由原 Controller 校验和发布开关处理，
 * 分开挂载使原收据读取可独立恢复，不能把参数分发器整体当作只读入口。 */
import { Body, Controller, Header, HttpCode, Inject, Optional, Post, Req } from "@nestjs/common";
import { AI_STAFF_INSPECTION_HTTP_DRAFT } from "@rental-os/shared";
import { StaffInspectionAssistController, AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_ENABLED,
  AI_STAFF_INSPECTION_OPERATIONS } from "@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller";
import { INSPECTION_RECOGNITION_TASKS } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-recognition-task.controller";

type Dependencies = ConstructorParameters<typeof StaffInspectionAssistController>;
type Request = Parameters<StaffInspectionAssistController["consume"]>[0];
const operations = AI_STAFF_INSPECTION_HTTP_DRAFT.operations;

@Controller(AI_STAFF_INSPECTION_HTTP_DRAFT.basePath)
export class RentalStaffInspectionAssistController {
  private readonly original: StaffInspectionAssistController;
  constructor(@Inject(AI_STAFF_INSPECTION_REQUESTS) requests: Dependencies[0],
    @Inject(AI_STAFF_INSPECTION_ENABLED) enabled: Dependencies[1],
    @Optional() @Inject(AI_STAFF_INSPECTION_OPERATIONS) permitted: Dependencies[2],
    @Optional() @Inject(INSPECTION_RECOGNITION_TASKS) tasks: Dependencies[3]) {
    this.original = new StaffInspectionAssistController(requests, enabled, permitted, tasks);
  }

  @Post(operations.fulfillmentReceiptRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  fulfillmentReceiptRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.fulfillmentReceiptRead, body); }
  @Post(operations.historyRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  historyRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.historyRead, body); }
  @Post(operations.receiptHostRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  receiptHostRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.receiptHostRead, body); }
  @Post(operations.hostRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  hostRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.hostRead, body); }
  @Post(operations.templateRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  templateRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.templateRead, body); }
  @Post(operations.evidenceBind) @HttpCode(200) @Header("Cache-Control", "no-store")
  evidenceBind(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.evidenceBind, body); }
  @Post(operations.evidenceFingerprint) @HttpCode(200) @Header("Cache-Control", "no-store")
  evidenceFingerprint(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.evidenceFingerprint, body); }
  @Post(operations.draftCreate) @HttpCode(200) @Header("Cache-Control", "no-store")
  draftCreate(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.draftCreate, body); }
  @Post(operations.draftRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  draftRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.draftRead, body); }
  @Post(operations.draftEdit) @HttpCode(200) @Header("Cache-Control", "no-store")
  draftEdit(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.draftEdit, body); }
  @Post(operations.evidenceReplace) @HttpCode(200) @Header("Cache-Control", "no-store")
  evidenceReplace(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.evidenceReplace, body); }
  @Post(operations.draftOperation) @HttpCode(200) @Header("Cache-Control", "no-store")
  draftOperation(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.draftOperation, body); }
  @Post(operations.inputPrepare) @HttpCode(200) @Header("Cache-Control", "no-store")
  inputPrepare(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.inputPrepare, body); }
  @Post(operations.inputReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  inputReceipt(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.inputReceipt, body); }
  @Post(operations.resultRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  resultRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.resultRead, body); }
  @Post(operations.resultSave) @HttpCode(200) @Header("Cache-Control", "no-store")
  resultSave(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.resultSave, body); }
  @Post(operations.resultSaveReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  resultSaveReceipt(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.resultSaveReceipt, body); }
  @Post(operations.submissionReview) @HttpCode(200) @Header("Cache-Control", "no-store")
  submissionReview(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.submissionReview, body); }
  @Post(operations.submissionPrepare) @HttpCode(200) @Header("Cache-Control", "no-store")
  submissionPrepare(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.submissionPrepare, body); }
  @Post(operations.submissionPreparation) @HttpCode(200) @Header("Cache-Control", "no-store")
  submissionPreparation(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.submissionPreparation, body); }
  @Post(operations.submissionSubmit) @HttpCode(200) @Header("Cache-Control", "no-store")
  submissionSubmit(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.submissionSubmit, body); }
  @Post(operations.submissionRead) @HttpCode(200) @Header("Cache-Control", "no-store")
  submissionRead(@Req() request: Request, @Body() body: unknown) { return this.original.consume(request, operations.submissionRead, body); }
}

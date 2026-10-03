export interface AiProposal { id: string; revision: string; title: string; expiresAt?: string; }
export class ProposalGate { private proposal: AiProposal | null = null; private checked = false; private pending = false;
  setProposal(proposal: AiProposal | null) { this.proposal = proposal; this.checked = false; }
  setChecked(value: boolean) { if (!this.expired) this.checked = value; }
  get expired() { return !this.proposal || (this.proposal.expiresAt !== undefined && this.proposal.expiresAt <= new Date().toISOString()); }
  get canSubmit() { return !!this.proposal && this.checked && !this.expired && !this.pending; }
  async submit(action: (proposal: AiProposal) => Promise<void>): Promise<"started" | "skipped" | "failed"> { if (!this.canSubmit || this.pending || !this.proposal) return "skipped"; const proposal = this.proposal; this.pending = true; try { await action(proposal); return "started"; } catch { return "failed"; } finally { this.pending = false; } }
}

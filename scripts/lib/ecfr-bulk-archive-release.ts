import type { GithubCommandResult, GithubRunner } from './ecfr-bulk-archive-github.js';

function record(value: unknown): Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid GitHub release identity');
  return value as Record<string,unknown>;
}
function identified(response: GithubCommandResult, tag: string, id?: number): GithubCommandResult {
  if(response.exitCode!==0)throw new Error('Cannot read discovered GitHub release: '+response.stderr);
  const value=record(JSON.parse(response.stdout));
  if(value.tag_name!==tag || (id!==undefined && value.id!==id))throw new Error('GitHub release identity differs from requested archive');
  return response;
}

/** Draft releases are discovered through the bounded list API before asset readback. */
export async function lookupGithubRelease(repository: string, tag: string, runner: GithubRunner): Promise<GithubCommandResult> {
  const direct=await runner(['api',`repos/${repository}/releases/tags/${tag}`]);
  if(direct.exitCode===0)return identified(direct,tag);
  if(!/release not found|HTTP 404|Not Found/i.test(direct.stderr))return direct;
  for(let page=1;page<=10;page++){
    const listed=await runner(['api',`repos/${repository}/releases?per_page=100&page=${page}`]);
    if(listed.exitCode!==0)throw new Error('Cannot discover draft GitHub releases: '+listed.stderr);
    const payload:unknown=JSON.parse(listed.stdout);
    if(!Array.isArray(payload)||payload.length>100)throw new Error('Invalid GitHub release listing');
    const matches=payload.map(record).filter(value=>value.tag_name===tag);
    if(matches.length>1)throw new Error('Duplicate GitHub archive release tag');
    const found=matches[0];
    if(found){
      if(!Number.isSafeInteger(found.id)||(found.id as number)<=0)throw new Error('Invalid GitHub release ID');
      return identified(await runner(['api',`repos/${repository}/releases/${found.id}`]),tag,found.id as number);
    }
    if(payload.length<100)return direct;
  }
  throw new Error('GitHub draft release discovery exceeded bounded history');
}

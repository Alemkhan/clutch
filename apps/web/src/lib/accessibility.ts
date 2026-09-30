export function shouldActivateAction(alreadyActivated: boolean, key?: string): boolean {
  if (alreadyActivated) return false;
  return key === undefined || key === 'Enter' || key === ' ';
}


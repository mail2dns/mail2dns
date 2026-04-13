import { setConfirm } from '../../src/utils.ts'

export function setConfirmYes() {
    setConfirm(async () => true) // always confirm
}

export function setConfirmNo() {
  setConfirm(async () => false)
}
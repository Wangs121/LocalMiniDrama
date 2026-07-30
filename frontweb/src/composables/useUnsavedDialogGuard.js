import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { stableStringify } from '../utils/aiEditEntities.js'

const CONFIRM_OPTIONS = {
  confirmButtonText: '保存',
  cancelButtonText: '放弃',
  distinguishCancelAndClose: true,
  closeOnClickModal: false,
  closeOnPressEscape: false,
  type: 'warning',
}

export function useUnsavedDialogGuard({
  getSnapshot,
  save,
  discard,
  close,
  confirm = () => ElMessageBox.confirm('当前修改尚未保存', '保存修改？', CONFIRM_OPTIONS),
}) {
  const cleanSnapshot = ref(null)
  const isDirty = computed(() => cleanSnapshot.value !== stableStringify(getSnapshot?.() || {}))

  function captureCleanSnapshot() {
    cleanSnapshot.value = stableStringify(getSnapshot?.() || {})
  }

  async function requestClose(closeOverride) {
    const closeAction = closeOverride || close
    if (!isDirty.value) {
      closeAction?.()
      return true
    }
    try {
      await confirm()
      await save?.()
      captureCleanSnapshot()
      closeAction?.()
      return true
    } catch (action) {
      if (action !== 'cancel') return false
      await discard?.()
      closeAction?.()
      return true
    }
  }

  function beforeClose(done) {
    return requestClose(done)
  }

  return { captureCleanSnapshot, isDirty, requestClose, beforeClose }
}

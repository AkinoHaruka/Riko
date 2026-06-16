package com.example.riko

class InstallBionicBypassStep : BootstrapStep {
    override val name = "InstallBionicBypass"

    override fun execute(context: BootstrapContext) {
        context.bootstrapManager.installBionicBypass()
    }
}

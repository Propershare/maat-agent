# Integration

## CLI

    maat [status|identity|policy|events|apps]

The installed CLI help reports this surface.

## Orchestrator

    const orchestrator = new MaatOrchestrator({ guard });
    orchestrator.registerAgent(new K2Agent(researcher));
    orchestrator.registerAgent(new CodingAgent(runner));
    const result = await orchestrator.submit({
      request: 'Research and implement the change',
      kind: 'research-and-development',
      methods: ['case-study'],
    });

## K2

    const researcher = new K2Researcher(source, { guard });
    const research = await researcher.research({
      question: 'Research question',
      methods: ['ka2'],
    });

## Runtime

    const runtime = new MaatRuntime(orchestrator, adaptive);
    const result = await runtime.handle({ request, kind });

## Governed action

    const service = new GovernedActionService(runtime, brokerClient, evidence);
    const outcome = await service.execute({
      actorId, toolName: 'fixture_write', resource, params,
      security: signedBinding,
    });

## Broker-backed AgentTool

    const tool = createBrokerAgentTool({
      service, actorId, secret,
      name: 'fixture_write', label: 'Brokered fixture write',
      description: 'Writes through the mandatory broker',
      parameters: Type.Object({ path: Type.String() }), resource: target,
    });

## Verified sequence

The installed tests verify Orchestrator to K2 delegation, research context transfer, real AgentSession execution, Guard allow and deny, signed binding validation, replay rejection, broker and Guard fail-closed behavior, and GitMaat evidence verification.
